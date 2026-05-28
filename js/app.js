const recipeImageBucket = "recipe-images";
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

async function getSavedRecipes() {
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
  return getSavedRecipes();
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

function recipeUrl(recipe) {
  return `rezept.html?id=${encodeURIComponent(recipe.id)}`;
}

function recipeCard(recipe) {
  const ingredientTags = recipe.ingredients
    .slice(0, 4)
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
        <span class="tag">${escapeHtml(recipe.category)}</span>
        <span class="tag">${escapeHtml(recipe.time)} Min.</span>
        ${recipe.servings ? `<span class="tag">${escapeHtml(recipe.servings)} Portionen</span>` : ""}
        ${ingredientTags}
      </div>
    </a>
  `;
}

function setupAuthNavigation() {
  const nav = document.querySelector(".main-nav");
  if (!nav) return;

  getCurrentUser().then((user) => {
    const existingAuthLink = nav.querySelector('a[href="auth.html"]');
    const authItem = document.createElement(user ? "button" : "a");
    authItem.className = user ? "nav-button" : "";
    authItem.textContent = user ? `Abmelden (${userName(user)})` : "Anmelden";

    if (user) {
      authItem.type = "button";
      authItem.addEventListener("click", async () => {
        await logoutUser();
        window.location.href = "auth.html";
      });
    } else {
      authItem.href = "auth.html";
      if (window.location.pathname.endsWith("auth.html")) {
        authItem.className = "active";
      }
    }

    if (existingAuthLink) {
      existingAuthLink.replaceWith(authItem);
    } else {
      nav.append(authItem);
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
      const matchesCategory = category === "alle" || recipe.category === category;
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

  if (imageInput && preview) {
    imageInput.addEventListener("change", async () => {
      const file = imageInput.files[0];
      if (!file) {
        preview.innerHTML = "<span>Noch kein Bild ausgewaehlt</span>";
        return;
      }

      if (!file.type.startsWith("image/")) {
        preview.innerHTML = "<span>Bitte waehle eine Bilddatei aus.</span>";
        imageInput.value = "";
        return;
      }

      const image = await readImageAsDataUrl(file);
      preview.innerHTML = `<img src="${image}" alt="Vorschau des ausgewaehlten Gerichts">`;
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = document.querySelector("#formMessage");
    const data = new FormData(form);
    const title = data.get("title").trim();
    const steps = data.get("steps").trim();
    const note = data.get("note").trim();
    const recipe = {
      title,
      category: data.get("category"),
      time: toNumber(data.get("time"), 30),
      servings: toNumber(data.get("servings"), 2),
      difficulty: data.get("difficulty"),
      prepTime: toNumber(data.get("prepTime"), 0),
      cookTime: toNumber(data.get("cookTime"), 0),
      ingredients: splitLines(data.get("ingredients")),
      steps,
      note: note || steps.split(/\n|\./)[0]
    };

    try {
      message.textContent = "Wird gespeichert...";
      await addSavedRecipe(recipe, data.get("image"));
      form.reset();
      form.elements.time.value = 30;
      form.elements.servings.value = 2;
      form.elements.prepTime.value = 10;
      form.elements.cookTime.value = 20;
      if (preview) preview.innerHTML = "<span>Noch kein Bild ausgewaehlt</span>";
      message.textContent = "Gespeichert. Du findest es jetzt auch in der Suche.";
    } catch (error) {
      message.textContent = error.message || "Das Rezept konnte nicht gespeichert werden.";
    }
  });
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
    recipe.difficulty || ""
  ].filter(Boolean);

  document.title = `${recipe.title} | Kuechenkompass`;
  container.innerHTML = `
    <section class="detail-hero">
      <a class="back-link" href="suche.html">Zurueck zur Suche</a>
      <div class="detail-hero-layout">
        <div>
          <p class="eyebrow">${escapeHtml(recipe.category)}</p>
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
}

renderDailyTips();
renderSearch();
setupAuthNavigation();
setupRecipeForm();
setupAuthForms();
renderRecipeDetail();
