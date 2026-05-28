const recipeImageBucket = "recipe-images";
const categoryGroups = [
  {
    title: "Ernaehrung",
    items: ["Vegan", "Vegetarisch", "Glutenfrei", "Laktosefrei", "Low Carb", "High Protein"]
  },
  {
    title: "Speiseart",
    items: ["Auflauf", "Eintopf", "Pasta", "Pizza", "Salat", "Suppen", "Hauptspeise", "Vorspeise", "Beilage"]
  },
  {
    title: "Zutaten",
    items: ["Nudeln", "Reis", "Kartoffeln", "Gemüse", "Hülsenfrüchte", "Käse", "Fisch", "Fleisch"]
  },
  {
    title: "Anlass",
    items: ["Frühstück", "Dessert", "Backen", "Kuchen", "Getränke", "Kinder", "Party", "Grillen", "Resteverwertung", "Meal Prep"]
  }
];
const defaultCategories = categoryGroups.flatMap((group) => group.items);
const ingredientUnits = ["g", "kg", "ml", "l", "Stk.", "EL", "TL", "Prise", "Bund", "Dose", "Packung"];
let supabaseClient;

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function slugify(value) {
  return String(value || "rezept")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "rezept";
}

function toNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function splitLines(value) {
  return String(value || "")
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function parseIngredient(value) {
  const parts = String(value || "").trim().split(/\s+/);
  const amount = parts[0] || "";
  const unit = ingredientUnits.includes(parts[1]) ? parts[1] : "";
  const name = unit ? parts.slice(2).join(" ") : parts.slice(1).join(" ");

  return {
    amount: /^\d/.test(amount) ? amount : "",
    unit,
    name: /^\d/.test(amount) ? name : String(value || "")
  };
}

function recipeDifficultyText(value) {
  const labels = {
    Einfach: 1,
    Mittel: 3,
    Anspruchsvoll: 5
  };
  const number = labels[value] || toNumber(value, 1);
  return `${number} ${number === 1 ? "Kompass" : "Kompasse"}`;
}

function recipeDifficultyValue(value) {
  const labels = {
    Einfach: 1,
    Mittel: 3,
    Anspruchsvoll: 5
  };
  return labels[value] || toNumber(value, 1);
}

function splitCategories(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function readImageAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) {
      resolve("");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function getSupabase() {
  if (supabaseClient) return supabaseClient;

  const config = window.KUECHENKOMPASS_SUPABASE || {};
  if (!window.supabase || !config.url || !config.anonKey || config.url.includes("DEIN-PROJEKT")) {
    return null;
  }

  supabaseClient = window.supabase.createClient(config.url, config.anonKey);
  return supabaseClient;
}

function showSupabaseMissing(target) {
  if (!target) return;
  target.innerHTML = `
    <section class="auth-required">
      <p class="eyebrow">Supabase verbinden</p>
      <h2>Trage zuerst deine Supabase-Zugangsdaten ein.</h2>
      <p>Oeffne <strong>supabase-config.js</strong> und setze dort deine Project URL und den anon public key ein.</p>
    </section>
  `;
}

async function getCurrentUser() {
  const client = getSupabase();
  if (!client) return null;

  const { data } = await client.auth.getUser();
  return data.user || null;
}

function userName(user) {
  return user?.user_metadata?.name || user?.email || "Konto";
}

async function signUpUser(name, email, password) {
  const client = getSupabase();
  if (!client) throw new Error("Supabase ist noch nicht konfiguriert.");

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: {
      data: { name: name.trim() }
    }
  });
  if (error) throw error;
  return data.user;
}

async function loginUser(email, password) {
  const client = getSupabase();
  if (!client) throw new Error("Supabase ist noch nicht konfiguriert.");

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

async function logoutUser() {
  const client = getSupabase();
  if (!client) return;

  await client.auth.signOut();
}

function normalizeRecipe(recipe) {
  return {
    id: recipe.id,
    userId: recipe.user_id || recipe.userId || "",
    isPublic: Boolean(recipe.is_public ?? recipe.isPublic),
    title: recipe.title,
    category: recipe.category,
    time: toNumber(recipe.time_minutes ?? recipe.time, 0),
    servings: toNumber(recipe.servings, 0),
    difficulty: recipe.difficulty || "Einfach",
    prepTime: toNumber(recipe.prep_time_minutes ?? recipe.prepTime, 0),
    cookTime: toNumber(recipe.cook_time_minutes ?? recipe.cookTime, 0),
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : splitLines(recipe.ingredients),
    steps: recipe.steps || "",
    note: recipe.note || "",
    image: recipe.image_url || recipe.image || "",
    createdAt: recipe.created_at || recipe.createdAt || ""
  };
}

async function getVisibleRecipes() {
  const client = getSupabase();
  const user = await getCurrentUser();
  if (!client) return [];

  let query = client
    .from("recipes")
    .select("*")
    .order("created_at", { ascending: false });

  query = user
    ? query.or(`is_public.eq.true,user_id.eq.${user.id}`)
    : query.eq("is_public", true);

  const { data, error } = await query;

  if (error) {
    console.error(error);
    return [];
  }

  return (data || []).map(normalizeRecipe);
}

async function allRecipes() {
  return getVisibleRecipes();
}

async function getOwnRecipes() {
  const client = getSupabase();
  const user = await getCurrentUser();
  if (!client || !user) return [];

  const { data, error } = await client
    .from("recipes")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_public", false)
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    return [];
  }

  return (data || []).map(normalizeRecipe);
}

async function getFavoriteRecipeIds() {
  const client = getSupabase();
  const user = await getCurrentUser();
  if (!client || !user) return [];

  const { data, error } = await client
    .from("recipe_favorites")
    .select("recipe_id")
    .eq("user_id", user.id);

  if (error) {
    console.error(error);
    return [];
  }

  return (data || []).map((favorite) => favorite.recipe_id);
}

async function getFavoriteRecipes() {
  const favoriteIds = await getFavoriteRecipeIds();
  if (!favoriteIds.length) return [];

  const recipes = await allRecipes();
  return recipes.filter((recipe) => favoriteIds.includes(recipe.id));
}

async function uploadRecipeImage(file, userId) {
  const client = getSupabase();
  if (!client || !file || !file.type.startsWith("image/")) return "";

  const extension = file.name.split(".").pop() || "jpg";
  const path = `${userId}/${Date.now()}-${slugify(file.name)}.${extension}`;
  const { error } = await client.storage
    .from(recipeImageBucket)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false
    });

  if (error) throw error;

  const { data } = client.storage.from(recipeImageBucket).getPublicUrl(path);
  return data.publicUrl;
}

async function addSavedRecipe(recipe, imageFile) {
  const client = getSupabase();
  const user = await getCurrentUser();
  if (!client || !user) throw new Error("Bitte melde dich an, um Rezepte zu speichern.");

  const imageUrl = await uploadRecipeImage(imageFile, user.id);
  const { error } = await client.from("recipes").insert({
    user_id: user.id,
    title: recipe.title,
    note: recipe.note,
    category: recipe.category,
    time_minutes: recipe.time,
    servings: recipe.servings,
    difficulty: recipe.difficulty,
    prep_time_minutes: recipe.prepTime,
    cook_time_minutes: recipe.cookTime,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    image_url: imageUrl
  });

  if (error) throw error;
}

async function updateSavedRecipe(recipeId, recipe, imageFile, currentImageUrl = "") {
  const client = getSupabase();
  const user = await getCurrentUser();
  if (!client || !user) throw new Error("Bitte melde dich an, um Rezepte zu bearbeiten.");

  const imageUrl = await uploadRecipeImage(imageFile, user.id) || currentImageUrl;
  const { error } = await client
    .from("recipes")
    .update({
      title: recipe.title,
      note: recipe.note,
      category: recipe.category,
      time_minutes: recipe.time,
      servings: recipe.servings,
      difficulty: recipe.difficulty,
      prep_time_minutes: recipe.prepTime,
      cook_time_minutes: recipe.cookTime,
      ingredients: recipe.ingredients,
      steps: recipe.steps,
      image_url: imageUrl
    })
    .eq("id", recipeId)
    .eq("user_id", user.id)
    .eq("is_public", false);

  if (error) throw error;
}

async function toggleFavorite(recipeId, shouldFavorite) {
  const client = getSupabase();
  const user = await getCurrentUser();
  if (!client || !user) throw new Error("Bitte melde dich an, um Favoriten zu speichern.");

  if (shouldFavorite) {
    const { error } = await client
      .from("recipe_favorites")
      .upsert({ user_id: user.id, recipe_id: recipeId }, { onConflict: "user_id,recipe_id" });
    if (error) throw error;
    return;
  }

  const { error } = await client
    .from("recipe_favorites")
    .delete()
    .eq("user_id", user.id)
    .eq("recipe_id", recipeId);
  if (error) throw error;
}

function recipeUrl(recipe) {
  return `rezept.html?id=${encodeURIComponent(recipe.id)}`;
}

function recipeCard(recipe) {
  const categoryTags = splitCategories(recipe.category)
    .map((item) => `<span class="tag">${escapeHtml(item)}</span>`)
    .join("");
  const ingredientTags = recipe.ingredients
    .slice(0, 0)
    .map((item) => `<span class="tag">${escapeHtml(item)}</span>`)
    .join("");
  const image = recipe.image
    ? `<img class="recipe-card-image" src="${recipe.image}" alt="${escapeHtml(recipe.title)}">`
    : "";

  return `
    <a class="recipe-card" href="${recipeUrl(recipe)}">
      ${image}
      <strong>${escapeHtml(recipe.title)}</strong>
      <p>${escapeHtml(recipe.note || "Ein eigenes Rezept aus deiner Sammlung.")}</p>
      <div class="tag-row">
        ${categoryTags}
        <span class="tag">${escapeHtml(recipe.time)} Min.</span>
        ${recipe.servings ? `<span class="tag">${escapeHtml(recipe.servings)} Portionen</span>` : ""}
        ${ingredientTags}
      </div>
    </a>
  `;
}

function createCategoryButton(category, activeCategory) {
  return `<button class="category-tab ${activeCategory ? "active" : ""}" data-category="${escapeAttribute(category)}" type="button">${escapeHtml(category)} ${activeCategory ? "" : "+"}</button>`;
}

function createIngredientRow(ingredient = {}) {
  const unitOptions = ingredientUnits
    .map((unit) => `<option ${unit === ingredient.unit ? "selected" : ""}>${escapeHtml(unit)}</option>`)
    .join("");

  return `
    <div class="ingredient-row">
      <input data-ingredient-amount inputmode="decimal" placeholder="Menge" value="${escapeAttribute(ingredient.amount || "")}">
      <select data-ingredient-unit>
        <option value="">Einheit</option>
        ${unitOptions}
      </select>
      <input data-ingredient-name placeholder="Zutat" value="${escapeAttribute(ingredient.name || "")}">
      <button class="icon-button" data-remove-row type="button" aria-label="Zutat entfernen">-</button>
    </div>
  `;
}

function createStepRow(value = "") {
  return `
    <div class="step-row">
      <textarea data-step-text rows="3" placeholder="Schritt beschreiben">${escapeHtml(value)}</textarea>
      <button class="icon-button" data-remove-row type="button" aria-label="Schritt entfernen">-</button>
    </div>
  `;
}

function setupRecipeBuilder(form, recipe = {}) {
  const categoryInput = form.elements.category;
  const categoryTabs = form.querySelector("[data-category-tabs]");
  const selectedCategories = form.querySelector("[data-selected-categories]");
  const customCategoryInput = form.querySelector("[data-custom-category]");
  const addCategoryButton = form.querySelector("[data-add-category]");
  const difficultyInput = form.elements.difficulty;
  const compassRating = form.querySelector("[data-compass-rating]");
  const prepInput = form.elements.prepTime;
  const cookInput = form.elements.cookTime;
  const totalTime = form.querySelector("[data-total-time]");
  const ingredientRows = form.querySelector("[data-ingredient-rows]");
  const stepRows = form.querySelector("[data-step-rows]");

  const initialSelectedCategories = splitCategories(recipe.category || "");
  const categories = [...new Set([...defaultCategories, ...initialSelectedCategories].filter(Boolean))];
  let activeCategories = initialSelectedCategories;

  const renderCategories = () => {
    categoryInput.value = activeCategories.join(", ");
    const customCategories = categories.filter((item) => !defaultCategories.includes(item));
    categoryTabs.innerHTML = [
      ...categoryGroups.map((group) => `
        <div class="category-group">
          <strong>${escapeHtml(group.title)}</strong>
          <div>
            ${group.items.map((item) => createCategoryButton(item, activeCategories.includes(item))).join("")}
          </div>
        </div>
      `),
      customCategories.length ? `
        <div class="category-group">
          <strong>Eigene Tags</strong>
          <div>
            ${customCategories.map((item) => createCategoryButton(item, activeCategories.includes(item))).join("")}
          </div>
        </div>
      ` : ""
    ].join("");
    selectedCategories.innerHTML = `
      <span>Ausgewaehlt</span>
      <div>
        ${activeCategories.length
          ? activeCategories
          .map((item) => `<button class="selected-category" data-selected-category="${escapeAttribute(item)}" type="button">${escapeHtml(item)} -</button>`)
          .join("")
          : `<span class="selected-empty">Keine Kategorie ausgewaehlt</span>`}
      </div>
    `;
  };

  const toggleCategory = (category) => {
    activeCategories = activeCategories.includes(category)
      ? activeCategories.filter((item) => item !== category)
      : [...activeCategories, category];
    renderCategories();
  };

  const setDifficulty = (difficulty) => {
    const value = String(Math.max(1, Math.min(5, recipeDifficultyValue(difficulty))));
    difficultyInput.value = value;
    compassRating.innerHTML = [1, 2, 3, 4, 5]
      .map((item) => `<button class="${item <= Number(value) ? "active" : ""}" data-difficulty="${item}" type="button" aria-label="${item} ${item === 1 ? "Kompass" : "Kompasse"}"><span class="material-symbols-outlined" aria-hidden="true">explore</span></button>`)
      .join("");
  };

  const updateTotalTime = () => {
    const total = toNumber(prepInput.value, 0) + toNumber(cookInput.value, 0);
    totalTime.textContent = `Gesamt: ${total} Min.`;
  };

  const ensureRemovableState = (container, selector) => {
    const rows = container.querySelectorAll(selector);
    rows.forEach((row) => {
      row.querySelector("[data-remove-row]").disabled = rows.length === 1;
    });
  };

  const addIngredient = (ingredient = {}) => {
    ingredientRows.insertAdjacentHTML("beforeend", createIngredientRow(ingredient));
    ensureRemovableState(ingredientRows, ".ingredient-row");
  };

  const addStep = (value = "") => {
    stepRows.insertAdjacentHTML("beforeend", createStepRow(value));
    ensureRemovableState(stepRows, ".step-row");
  };

  categoryTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (button) toggleCategory(button.dataset.category);
  });

  selectedCategories.addEventListener("click", (event) => {
    const button = event.target.closest("[data-selected-category]");
    if (button) toggleCategory(button.dataset.selectedCategory);
  });

  addCategoryButton.addEventListener("click", () => {
    const category = customCategoryInput.value.trim();
    if (!category) return;
    if (!categories.includes(category)) categories.push(category);
    if (!activeCategories.includes(category)) activeCategories.push(category);
    customCategoryInput.value = "";
    renderCategories();
  });

  compassRating.addEventListener("click", (event) => {
    const button = event.target.closest("[data-difficulty]");
    if (button) setDifficulty(button.dataset.difficulty);
  });

  [prepInput, cookInput].forEach((input) => input.addEventListener("input", updateTotalTime));

  form.querySelector("[data-add-ingredient]").addEventListener("click", () => addIngredient());
  form.querySelector("[data-add-step]").addEventListener("click", () => addStep());

  form.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-row]");
    if (!button) return;

    const ingredientRow = button.closest(".ingredient-row");
    const stepRow = button.closest(".step-row");
    if (ingredientRow && ingredientRows.querySelectorAll(".ingredient-row").length > 1) {
      ingredientRow.remove();
      ensureRemovableState(ingredientRows, ".ingredient-row");
    }
    if (stepRow && stepRows.querySelectorAll(".step-row").length > 1) {
      stepRow.remove();
      ensureRemovableState(stepRows, ".step-row");
    }
  });

  if (recipe.prepTime !== undefined) prepInput.value = recipe.prepTime;
  if (recipe.cookTime !== undefined) cookInput.value = recipe.cookTime;
  if (recipe.servings !== undefined && form.elements.servings) form.elements.servings.value = recipe.servings || 2;

  renderCategories();
  setDifficulty(recipe.difficulty || 1);
  updateTotalTime();

  const ingredients = recipe.ingredients?.length ? recipe.ingredients.map(parseIngredient) : [{}];
  ingredients.forEach(addIngredient);
  const steps = recipe.steps ? String(recipe.steps).split(/\n+/).filter(Boolean) : [""];
  steps.forEach(addStep);
}

function myRecipeCard(recipe) {
  return `
    <article class="recipe-card">
      ${recipe.image ? `<img class="recipe-card-image" src="${recipe.image}" alt="${escapeHtml(recipe.title)}">` : ""}
      <strong>${escapeHtml(recipe.title)}</strong>
      <p>${escapeHtml(recipe.note || "Ein eigenes Rezept aus deiner Sammlung.")}</p>
      <div class="tag-row">
        ${splitCategories(recipe.category).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
        <span class="tag">${escapeHtml(recipe.time)} Min.</span>
        ${recipe.servings ? `<span class="tag">${escapeHtml(recipe.servings)} Portionen</span>` : ""}
      </div>
      <div class="card-actions">
        <a class="text-button" href="${recipeUrl(recipe)}">Ansehen</a>
        <a class="text-button" href="bearbeiten.html?id=${encodeURIComponent(recipe.id)}">Bearbeiten</a>
      </div>
    </article>
  `;
}

function setupAuthNavigation() {
  const nav = document.querySelector(".main-nav");
  if (!nav) return;

  getCurrentUser().then((user) => {
    const currentPage = window.location.pathname.split("/").pop() || "index.html";
    const links = user
      ? [
        ["index.html", "Start"],
        ["suche.html", "Rezeptsuche"]
      ]
      : [
        ["index.html", "Start"],
        ["suche.html", "Rezeptsuche"],
        ["auth.html", "Anmelden"]
      ];

    nav.innerHTML = links
      .map(([href, label]) => `<a class="${currentPage === href ? "active" : ""}" href="${href}">${label}</a>`)
      .join("");

    if (user) {
      const userMenu = document.createElement("div");
      const menuPages = ["erstellen.html", "meine-rezepte.html", "favoriten.html", "bearbeiten.html"];
      userMenu.className = "user-menu";
      userMenu.innerHTML = `
        <button class="nav-button user-menu-button ${menuPages.includes(currentPage) ? "active" : ""}" type="button" aria-expanded="false">
          ${escapeHtml(userName(user))}
        </button>
        <div class="user-menu-panel">
          <a class="${currentPage === "erstellen.html" ? "active" : ""}" href="erstellen.html">Rezept erstellen</a>
          <a class="${currentPage === "meine-rezepte.html" ? "active" : ""}" href="meine-rezepte.html">Meine Rezepte</a>
          <a class="${currentPage === "favoriten.html" ? "active" : ""}" href="favoriten.html">Meine Favoriten</a>
          <button class="menu-logout" type="button">Abmelden</button>
        </div>
      `;
      const menuButton = userMenu.querySelector(".user-menu-button");
      const logoutButton = userMenu.querySelector(".menu-logout");
      menuButton.addEventListener("click", () => {
        const isOpen = userMenu.classList.toggle("open");
        menuButton.setAttribute("aria-expanded", String(isOpen));
      });
      logoutButton.type = "button";
      logoutButton.addEventListener("click", async () => {
        await logoutUser();
        window.location.href = "auth.html";
      });
      document.addEventListener("click", (event) => {
        if (!userMenu.contains(event.target)) {
          userMenu.classList.remove("open");
          menuButton.setAttribute("aria-expanded", "false");
        }
      });
      nav.append(userMenu);
    }
  });
}

async function renderDailyTips() {
  const container = document.querySelector("#dailyTips");
  if (!container) return;

  const tips = (await allRecipes()).slice(0, 3);
  container.innerHTML = tips
    .map((recipe, index) => `
      <a class="tip-card" href="${recipeUrl(recipe)}">
        <strong>${index === 0 ? "Tipp des Tages" : "Auch gut heute"}</strong>
        <h3>${escapeHtml(recipe.title)}</h3>
        <p>${escapeHtml(recipe.note || "Aus deiner eigenen Sammlung, bereit fuer den naechsten Kochabend.")}</p>
        <div class="tag-row">
          <span class="tag">${escapeHtml(recipe.category)}</span>
          <span class="tag">${escapeHtml(recipe.time)} Min.</span>
          ${recipe.servings ? `<span class="tag">${escapeHtml(recipe.servings)} Portionen</span>` : ""}
        </div>
      </a>
    `)
    .join("");
}

async function renderSearch() {
  const results = document.querySelector("#recipeResults");
  if (!results) return;

  const searchInput = document.querySelector("#searchInput");
  const categoryFilter = document.querySelector("#categoryFilter");
  const timeFilter = document.querySelector("#timeFilter");
  const count = document.querySelector("#resultCount");
  const recipes = await allRecipes();

  const applyFilters = () => {
    const query = searchInput.value.trim().toLowerCase();
    const category = categoryFilter.value;
    const maxTime = Number(timeFilter.value);

    const filtered = recipes.filter((recipe) => {
      const haystack = [
        recipe.title,
        recipe.category,
        recipe.note,
        recipe.difficulty,
        recipe.steps,
        ...recipe.ingredients
      ].join(" ").toLowerCase();
      const matchesQuery = !query || haystack.includes(query);
      const matchesCategory = category === "alle" || splitCategories(recipe.category).includes(category);
      const matchesTime = recipe.time <= maxTime;
      return matchesQuery && matchesCategory && matchesTime;
    });

    count.textContent = `${filtered.length} ${filtered.length === 1 ? "Rezept" : "Rezepte"}`;
    results.innerHTML = filtered.length
      ? filtered.map(recipeCard).join("")
      : `<p class="empty-state">Keine Treffer. Probiere eine andere Zutat oder lockere die Filter.</p>`;
  };

  [searchInput, categoryFilter, timeFilter].forEach((field) => field.addEventListener("input", applyFilters));
  document.querySelector("#resetFilters").addEventListener("click", () => {
    searchInput.value = "";
    categoryFilter.value = "alle";
    timeFilter.value = "999";
    applyFilters();
  });
  applyFilters();
}

async function setupRecipeForm() {
  const form = document.querySelector("#recipeForm");
  if (!form) return;

  if (!getSupabase()) {
    showSupabaseMissing(form.parentElement);
    return;
  }

  const user = await getCurrentUser();
  if (!user) {
    form.outerHTML = `
      <section class="auth-required">
        <p class="eyebrow">Anmeldung erforderlich</p>
        <h2>Melde dich an, um eigene Rezepte zu speichern.</h2>
        <p>So bleiben deine Rezepte deiner Sammlung zugeordnet und sind auf deinen Geraeten verfuegbar.</p>
        <a class="button primary" href="auth.html">Anmelden oder registrieren</a>
      </section>
    `;
    return;
  }

  const imageInput = form.elements.image;
  const preview = document.querySelector("#imagePreview");
  setupRecipeBuilder(form, {
    category: "Vegetarisch",
    difficulty: 1,
    prepTime: 10,
    cookTime: 20,
    ingredients: [""],
    steps: ""
  });

  if (imageInput && preview) {
    imageInput.addEventListener("change", async () => {
      const file = imageInput.files[0];
      if (!file) {
        preview.innerHTML = "";
        preview.hidden = true;
        return;
      }

      if (!file.type.startsWith("image/")) {
        preview.innerHTML = "";
        preview.hidden = true;
        imageInput.value = "";
        return;
      }

      const image = await readImageAsDataUrl(file);
      preview.hidden = false;
      preview.innerHTML = `<img src="${image}" alt="Vorschau des ausgewaehlten Gerichts">`;
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.querySelector("#formMessage");

    try {
      const data = new FormData(form);
      const recipe = recipeFromForm(form);
      message.textContent = "Wird gespeichert...";
      await addSavedRecipe(recipe, data.get("image"));
      window.location.href = "meine-rezepte.html";
    } catch (error) {
      message.textContent = error.message || "Das Rezept konnte nicht gespeichert werden.";
    }
  });
}

function recipeFromForm(form) {
  const data = new FormData(form);
  const title = data.get("title").trim();
  const steps = [...form.querySelectorAll("[data-step-text]")]
    .map((input) => input.value.trim())
    .filter(Boolean)
    .join("\n");
  const note = data.get("note").trim();
  const prepTime = toNumber(data.get("prepTime"), 0);
  const cookTime = toNumber(data.get("cookTime"), 0);
  const ingredients = [...form.querySelectorAll(".ingredient-row")]
    .map((row) => {
      const amount = row.querySelector("[data-ingredient-amount]").value.trim();
      const unit = row.querySelector("[data-ingredient-unit]").value.trim();
      const name = row.querySelector("[data-ingredient-name]").value.trim();
      return [amount, unit, name].filter(Boolean).join(" ");
    })
    .filter(Boolean);

  if (!ingredients.length) throw new Error("Bitte fuege mindestens eine Zutat hinzu.");
  if (!steps) throw new Error("Bitte fuege mindestens einen Zubereitungsschritt hinzu.");

  return {
    title,
    category: data.get("category"),
    time: prepTime + cookTime,
    servings: toNumber(data.get("servings"), 2),
    difficulty: data.get("difficulty"),
    prepTime,
    cookTime,
    ingredients,
    steps,
    note: note || steps.split(/\n|\./)[0]
  };
}

function setupAuthForms() {
  const loginForm = document.querySelector("#loginForm");
  const signupForm = document.querySelector("#signupForm");
  const message = document.querySelector("#authMessage");
  if (!loginForm || !signupForm) return;

  if (!getSupabase()) {
    message.textContent = "Bitte trage zuerst deine Supabase-Zugangsdaten in supabase-config.js ein.";
    loginForm.querySelector("button").disabled = true;
    signupForm.querySelector("button").disabled = true;
    return;
  }

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(loginForm);
    try {
      message.textContent = "Anmeldung laeuft...";
      await loginUser(data.get("email"), data.get("password"));
      window.location.href = "erstellen.html";
    } catch (error) {
      message.textContent = error.message || "Anmeldung fehlgeschlagen.";
    }
  });

  signupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(signupForm);
    try {
      message.textContent = "Konto wird erstellt...";
      await signUpUser(data.get("name"), data.get("email"), data.get("password"));
      window.location.href = "erstellen.html";
    } catch (error) {
      message.textContent = error.message || "Registrierung fehlgeschlagen.";
    }
  });
}

async function renderMyRecipes() {
  const container = document.querySelector("#myRecipes");
  if (!container) return;

  if (!getSupabase()) {
    showSupabaseMissing(container);
    return;
  }

  const user = await getCurrentUser();
  if (!user) {
    container.innerHTML = `
      <section class="auth-required">
        <p class="eyebrow">Anmeldung erforderlich</p>
        <h2>Melde dich an, um deine Rezepte zu sehen.</h2>
        <a class="button primary" href="auth.html">Anmelden</a>
      </section>
    `;
    return;
  }

  const recipes = await getOwnRecipes();
  container.innerHTML = recipes.length
    ? recipes.map(myRecipeCard).join("")
    : `<p class="empty-state">Du hast noch keine eigenen Rezepte erstellt.</p>`;
}

async function renderFavorites() {
  const container = document.querySelector("#favoriteRecipes");
  if (!container) return;

  if (!getSupabase()) {
    showSupabaseMissing(container);
    return;
  }

  const user = await getCurrentUser();
  if (!user) {
    container.innerHTML = `
      <section class="auth-required">
        <p class="eyebrow">Anmeldung erforderlich</p>
        <h2>Melde dich an, um Favoriten zu speichern.</h2>
        <a class="button primary" href="auth.html">Anmelden</a>
      </section>
    `;
    return;
  }

  const recipes = await getFavoriteRecipes();
  container.innerHTML = recipes.length
    ? recipes.map(recipeCard).join("")
    : `<p class="empty-state">Noch keine Favoriten gespeichert.</p>`;
}

async function setupEditRecipeForm() {
  const form = document.querySelector("#editRecipeForm");
  if (!form) return;

  if (!getSupabase()) {
    showSupabaseMissing(form.parentElement);
    return;
  }

  const user = await getCurrentUser();
  if (!user) {
    form.outerHTML = `
      <section class="auth-required">
        <p class="eyebrow">Anmeldung erforderlich</p>
        <h2>Melde dich an, um Rezepte zu bearbeiten.</h2>
        <a class="button primary" href="auth.html">Anmelden</a>
      </section>
    `;
    return;
  }

  const recipeId = new URLSearchParams(window.location.search).get("id");
  const message = document.querySelector("#editMessage");
  const preview = document.querySelector("#editImagePreview");
  const imageInput = form.elements.image;
  const recipes = await getOwnRecipes();
  const recipe = recipes.find((item) => item.id === recipeId);

  if (!recipe) {
    form.outerHTML = `
      <section class="auth-required">
        <p class="eyebrow">Nicht gefunden</p>
        <h2>Dieses Rezept kannst du hier nicht bearbeiten.</h2>
        <a class="button primary" href="meine-rezepte.html">Zu meinen Rezepten</a>
      </section>
    `;
    return;
  }

  form.elements.title.value = recipe.title;
  form.elements.note.value = recipe.note;
  setupRecipeBuilder(form, recipe);
  if (preview) {
    preview.hidden = !recipe.image;
    preview.innerHTML = recipe.image ? `<img src="${recipe.image}" alt="${escapeHtml(recipe.title)}">` : "";
  }

  if (imageInput && preview) {
    imageInput.addEventListener("change", async () => {
      const file = imageInput.files[0];
      if (!file) {
        preview.hidden = !recipe.image;
        preview.innerHTML = recipe.image ? `<img src="${recipe.image}" alt="${escapeHtml(recipe.title)}">` : "";
        return;
      }

      if (!file.type.startsWith("image/")) {
        preview.hidden = !recipe.image;
        preview.innerHTML = recipe.image ? `<img src="${recipe.image}" alt="${escapeHtml(recipe.title)}">` : "";
        imageInput.value = "";
        return;
      }

      const image = await readImageAsDataUrl(file);
      preview.hidden = false;
      preview.innerHTML = `<img src="${image}" alt="Vorschau des ausgewaehlten Gerichts">`;
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      message.textContent = "Aenderungen werden gespeichert...";
      await updateSavedRecipe(recipe.id, recipeFromForm(form), new FormData(form).get("image"), recipe.image);
      message.textContent = "Gespeichert.";
    } catch (error) {
      message.textContent = error.message || "Das Rezept konnte nicht gespeichert werden.";
    }
  });
}

async function renderRecipeDetail() {
  const container = document.querySelector("#recipeDetail");
  if (!container) return;

  const id = new URLSearchParams(window.location.search).get("id");
  const recipe = (await allRecipes()).find((item) => item.id === id);

  if (!recipe) {
    container.innerHTML = `
      <section class="detail-card">
        <p class="eyebrow">Nicht gefunden</p>
        <h1>Dieses Rezept gibt es hier noch nicht.</h1>
        <p class="detail-note">Gehe zur Suche zurueck und waehle ein anderes Rezept aus.</p>
        <a class="button primary" href="suche.html">Zur Rezeptsuche</a>
      </section>
    `;
    return;
  }

  const ingredients = recipe.ingredients
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");
  const steps = escapeHtml(recipe.steps || recipe.note || "Noch keine Zubereitung hinterlegt.")
    .split(/\n+/)
    .map((step) => step.trim())
    .filter(Boolean)
    .map((step) => `<li>${step}</li>`)
    .join("");
  const detailImage = recipe.image
    ? `<img class="detail-image" src="${recipe.image}" alt="${escapeHtml(recipe.title)}">`
    : "";
  const prepDetails = [
    recipe.prepTime ? `${recipe.prepTime} Min. Vorbereitung` : "",
    recipe.cookTime ? `${recipe.cookTime} Min. Kochzeit` : "",
    recipeDifficultyText(recipe.difficulty)
  ].filter(Boolean);

  document.title = `${recipe.title} | Kuechenkompass`;
  container.innerHTML = `
    <section class="detail-hero">
      <a class="back-link" href="suche.html">Zurueck zur Suche</a>
      <div class="detail-hero-layout">
        <div>
          <p class="eyebrow">${escapeHtml(recipe.category || "Rezept")}</p>
          <h1>${escapeHtml(recipe.title)}</h1>
          <p class="detail-note">${escapeHtml(recipe.note || "Ein eigenes Rezept aus deiner Sammlung.")}</p>
          <div class="tag-row">
            <span class="tag">${escapeHtml(recipe.time)} Min.</span>
            <span class="tag">${escapeHtml(recipe.ingredients.length)} Zutaten</span>
            ${recipe.servings ? `<span class="tag">${escapeHtml(recipe.servings)} Portionen</span>` : ""}
            ${prepDetails.map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("")}
          </div>
        </div>
        ${detailImage}
      </div>
    </section>

    <section class="detail-actions" id="recipeActions"></section>

    <section class="detail-grid">
      <article class="detail-card">
        <h2>Zutaten</h2>
        <ul class="ingredient-list">${ingredients}</ul>
      </article>
      <article class="detail-card">
        <h2>Zubereitung</h2>
        <ol class="step-list">${steps}</ol>
      </article>
    </section>
  `;

  setupRecipeActions(recipe);
}

async function setupRecipeActions(recipe) {
  const container = document.querySelector("#recipeActions");
  if (!container) return;

  const user = await getCurrentUser();
  if (!user) return;

  const favoriteIds = await getFavoriteRecipeIds();
  const isFavorite = favoriteIds.includes(recipe.id);
  const canEdit = recipe.userId === user.id && !recipe.isPublic;

  container.innerHTML = `
    <button class="button ${isFavorite ? "ghost" : "primary"}" id="favoriteButton" type="button">
      ${isFavorite ? "Aus Favoriten entfernen" : "Zu Favoriten"}
    </button>
    ${canEdit ? `<a class="button ghost" href="bearbeiten.html?id=${encodeURIComponent(recipe.id)}">Rezept bearbeiten</a>` : ""}
  `;

  document.querySelector("#favoriteButton").addEventListener("click", async () => {
    await toggleFavorite(recipe.id, !isFavorite);
    setupRecipeActions(recipe);
  });
}

renderDailyTips();
renderSearch();
setupAuthNavigation();
setupRecipeForm();
setupAuthForms();
renderMyRecipes();
renderFavorites();
setupEditRecipeForm();
renderRecipeDetail();
