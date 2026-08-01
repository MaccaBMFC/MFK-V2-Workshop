
const cfg=window.MACCA_CONFIG||{};
const configured=cfg.SUPABASE_URL&&!cfg.SUPABASE_URL.startsWith("PASTE_")&&cfg.SUPABASE_PUBLISHABLE_KEY&&!cfg.SUPABASE_PUBLISHABLE_KEY.startsWith("PASTE_");
const db=configured?window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY):null;
const $=id=>document.getElementById(id);
let recipes=[],categories=[],members=[],shoppingLists=[],shoppingItems=[],masterIngredients=[],structuredRows=[],recipeFavourites=[],activeCategory="All",activeShopping="woolworths",currentUser=null,managerCurrentRecipe=null;

const safeArray=v=>Array.isArray(v)?v:[];
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

function setPage(page){
  document.querySelectorAll(".page").forEach(p=>p.classList.toggle("active",p.dataset.pageName===page));
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.page===page));
  window.scrollTo({top:0,behavior:"smooth"});
  history.replaceState(null,"",`#${page}`);
}
document.querySelectorAll("[data-page]").forEach(b=>b.onclick=()=>setPage(b.dataset.page));

function showLogin(){if(!db){alert("Copy your working config.js into this V2 repository first.");return}$("login-dialog").showModal()}
$("sign-in-button").onclick=showLogin;
$("sign-out-button").onclick=async()=>{await db.auth.signOut();currentUser=null;applySession();await loadPrivateData()};
document.querySelectorAll("[data-close-dialog]").forEach(b=>b.onclick=()=>$(b.dataset.closeDialog).close());

$("login-form").addEventListener("submit",async e=>{
  e.preventDefault();$("login-message").textContent="Signing in…";
  const {data,error}=await db.auth.signInWithPassword({email:$("login-email").value.trim(),password:$("login-password").value});
  if(error){$("login-message").textContent=error.message;return}
  currentUser=data.user;$("login-message").textContent="";$("login-dialog").close();applySession();await loadPrivateData();
});
function applySession(){
  $("sign-in-button").hidden=!!currentUser;$("sign-out-button").hidden=!currentUser;
  $("user-label").textContent=currentUser?.email||"";
}

async function init(){
  const requested=location.hash.replace("#","")||"today";
  if(["today","planner","recipes","shopping","settings"].includes(requested))setPage(requested);
  if(!db){$("recipe-status").hidden=false;$("recipe-status").textContent="Supabase is not connected. Copy your existing config.js into this repository.";return}
  const {data:{session}}=await db.auth.getSession();currentUser=session?.user||null;applySession();
  await Promise.all([loadPublicData(),loadPrivateData()]);
}
async function loadPublicData(){
  const [r,c,m,i,ri,rf]=await Promise.all([
    db.from("recipes").select("*").eq("is_archived",false).order("title"),
    db.from("categories").select("*").order("sort_order").order("name"),
    db.from("family_members").select("*").eq("is_active",true).order("sort_order"),
    db.from("ingredients").select("*").eq("is_active",true).order("name"),
    db.from("recipe_ingredients_expanded").select("*").order("sort_order"),
    db.from("recipe_favourites").select("*")
  ]);
  const error=[r,c,m,i,ri,rf].find(x=>x.error)?.error;
  if(error){$("recipe-status").hidden=false;$("recipe-status").textContent=error.message;return}
  recipes=r.data||[];categories=c.data||[];members=m.data||[];
  masterIngredients=i.data||[];structuredRows=ri.data||[];recipeFavourites=rf.data||[];
  $("settings-category-count").textContent=categories.length;$("settings-member-count").textContent=members.length;
  renderFilters();renderRecipes();renderManagerReferenceData();renderManagerLibrary();
}
async function loadPrivateData(){
  if(!currentUser){
    shoppingLists=[];shoppingItems=[];renderShopping();renderShoppingCounts();return;
  }
  const [l,i]=await Promise.all([
    db.from("shopping_lists").select("*").order("destination"),
    db.from("shopping_items").select("*").order("sort_order").order("created_at")
  ]);
  if(l.error||i.error){console.error(l.error||i.error);return}
  shoppingLists=l.data||[];shoppingItems=i.data||[];renderShopping();renderShoppingCounts();
}
function renderFilters(){
  $("category-filters").innerHTML=[
    `<button class="filter ${activeCategory==="All"?"active":""}" data-category="All">All recipes</button>`,
    ...categories.map(c=>`<button class="filter ${activeCategory===c.name?"active":""}" data-category="${esc(c.name)}">${esc(c.icon||"🍽️")} ${esc(c.name)}</button>`)
  ].join("");
  document.querySelectorAll("[data-category]").forEach(b=>b.onclick=()=>{activeCategory=b.dataset.category;renderFilters();renderRecipes()});
}
function matchesRecipe(r,q){
  return [r.title,r.category,r.story,...safeArray(r.ingredients),...safeArray(r.tags)].join(" ").toLowerCase().includes(q.toLowerCase());
}
function renderRecipes(){
  const q=$("recipe-search").value.trim();
  const list=recipes.filter(r=>(activeCategory==="All"||r.category===activeCategory)&&(!q||matchesRecipe(r,q)));
  $("recipe-grid").innerHTML=list.length?list.map(r=>`
    <article class="recipe-card" data-recipe-id="${r.id}">
      <div class="card-visual"><span class="category-pill">${esc(r.category||"Recipe")}</span>${esc(r.emoji||"🍽️")}</div>
      <div class="card-body"><h3>${esc(r.title)}</h3><p class="card-story">${esc(r.story||"")}</p>
      <div class="meta"><span>⏱ ${esc(r.prep||"—")} prep</span><span>🍽 Serves ${esc(r.base_servings??r.serves??"—")}</span></div></div>
    </article>`).join(""):'<div class="empty-state"><span>🔎</span><h2>No recipes found</h2><p>Try another search or category.</p></div>';
  document.querySelectorAll("[data-recipe-id]").forEach(c=>c.onclick=()=>openRecipe(c.dataset.recipeId));
}
$("recipe-search").oninput=renderRecipes;

function openRecipe(id){
  const r=recipes.find(x=>x.id===id);if(!r)return;
  $("recipe-detail").innerHTML=`
    <div class="recipe-hero"><div class="detail-emoji">${esc(r.emoji||"🍽️")}</div><p class="eyebrow">${esc(r.category||"Recipe")}</p><h2>${esc(r.title)}</h2></div>
    <div class="recipe-body">
      ${r.story?`<p>${esc(r.story)}</p>`:""}
      <div class="info-strip"><div class="info-box"><strong>Prep</strong>${esc(r.prep||"—")}</div><div class="info-box"><strong>Cook</strong>${esc(r.cook||"—")}</div><div class="info-box"><strong>Serves</strong>${esc(r.base_servings??r.serves??"—")}</div></div>
      <section class="recipe-section"><h3>🛒 Ingredients</h3><ul>${safeArray(r.ingredients).map(x=>`<li>${esc(x)}</li>`).join("")}</ul></section>
      <section class="recipe-section"><h3>👨‍🍳 Method</h3><ol>${safeArray(r.method).map(x=>`<li>${esc(x)}</li>`).join("")}</ol></section>
      ${safeArray(r.tips).length?`<section class="recipe-section tip-box"><h3>💡 Macca's Tips</h3><ul>${r.tips.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></section>`:""}
    </div>`;
  $("recipe-dialog").showModal();
}

document.querySelectorAll(".shopping-tab").forEach(b=>b.onclick=()=>{
  activeShopping=b.dataset.shoppingTab;document.querySelectorAll(".shopping-tab").forEach(x=>x.classList.toggle("active",x===b));renderShopping();
});
document.querySelectorAll("[data-list]").forEach(b=>b.onclick=()=>{activeShopping=b.dataset.list;setPage("shopping");document.querySelectorAll(".shopping-tab").forEach(x=>x.classList.toggle("active",x.dataset.shoppingTab===activeShopping));renderShopping()});

function getListId(destination){return shoppingLists.find(x=>x.destination===destination)?.id}
function activeItems(){const listId=getListId(activeShopping);return shoppingItems.filter(x=>x.shopping_list_id===listId)}
function renderShoppingCounts(){
  const woolId=getListId("woolworths"),fruitId=getListId("fruit_veg");
  $("woolies-count").textContent=shoppingItems.filter(x=>x.shopping_list_id===woolId&&!x.is_checked).length;
  $("fruit-count").textContent=shoppingItems.filter(x=>x.shopping_list_id===fruitId&&!x.is_checked).length;
}
function renderShopping(){
  if(!currentUser){
    $("shopping-list-content").innerHTML='<div class="empty-state"><span>🔐</span><h2>Sign in to use shopping</h2><p>Your lists are private to signed-in family accounts.</p></div>';return;
  }
  const list=activeItems();
  $("shopping-list-content").innerHTML=list.length?list.map(x=>`
    <label style="display:flex;gap:12px;align-items:center;padding:13px;border-bottom:1px solid var(--line)">
      <input type="checkbox" data-shopping-check="${x.id}" ${x.is_checked?"checked":""} style="width:22px;height:22px">
      <span style="${x.is_checked?"text-decoration:line-through;color:var(--muted)":""}">${esc([x.quantity,x.unit,x.item_name].filter(v=>v!==null&&v!=="").join(" "))}</span>
    </label>`).join(""):'<div class="empty-state"><span>🧺</span><h2>No items yet</h2><p>Add items during the week, or generate them from the meal planner later.</p></div>';
  document.querySelectorAll("[data-shopping-check]").forEach(c=>c.onchange=async()=>{
    const {error}=await db.from("shopping_items").update({is_checked:c.checked}).eq("id",c.dataset.shoppingCheck);
    if(!error){const item=shoppingItems.find(x=>x.id===c.dataset.shoppingCheck);if(item)item.is_checked=c.checked;renderShopping();renderShoppingCounts()}
  });
}
$("add-shopping-item").onclick=async()=>{
  if(!currentUser){showLogin();return}
  const name=$("shopping-name").value.trim();if(!name)return;
  const payload={shopping_list_id:getListId(activeShopping),item_name:name,quantity:Number($("shopping-qty").value)||null,unit:$("shopping-unit").value.trim()||null,source_type:"manual"};
  const {data,error}=await db.from("shopping_items").insert(payload).select().single();
  if(error){alert(error.message);return}
  shoppingItems.push(data);$("shopping-name").value="";$("shopping-qty").value="";$("shopping-unit").value="";renderShopping();renderShoppingCounts();
};


/* =========================================================
   V2 RECIPE MANAGER
========================================================= */

const managerLineArray=value=>Array.isArray(value)?value:String(value||"").split("\n").map(x=>x.trim()).filter(Boolean);
const managerNormalized=value=>String(value||"").trim().toLowerCase().replace(/\s+/g," ");
const managerNumeric=value=>{
  const text=String(value??"").trim().replace(",",".");
  if(!text)return null;
  const n=Number(text);
  return Number.isFinite(n)?n:null;
};
const structuredForRecipe=id=>structuredRows.filter(x=>x.recipe_id===id);
const favouritesForRecipe=id=>new Set(recipeFavourites.filter(x=>x.recipe_id===id).map(x=>x.family_member_id));
const recipeIsStructured=id=>structuredForRecipe(id).length>0;

$("open-recipe-manager").onclick=()=>{
  if(!currentUser){showLogin();return}
  renderManagerReferenceData();
  renderManagerLibrary();
  $("recipe-manager-dialog").showModal();
};

$("manager-new-recipe").onclick=()=>managerOpenNew();
$("manager-search").oninput=renderManagerLibrary;
$("manager-filter").onchange=renderManagerLibrary;
$("manager-add-ingredient").onclick=()=>managerAddIngredientRow();
$("manager-cancel").onclick=()=>managerCloseEditor();

function renderManagerReferenceData(){
  if(!$("manager-category"))return;
  const selectedCategory=$("manager-category").value;
  const selectedOwner=$("manager-owner").value;

  $("manager-category").innerHTML='<option value="">Select…</option>'+
    categories.map(c=>`<option value="${esc(c.name)}">${esc(c.icon||"🍽️")} ${esc(c.name)}</option>`).join("");
  $("manager-owner").innerHTML='<option value="">Not assigned</option>'+
    members.map(m=>`<option value="${m.id}">${esc(m.avatar_emoji||"👤")} ${esc(m.display_name)}</option>`).join("");
  $("manager-ingredient-suggestions").innerHTML=
    masterIngredients.map(i=>`<option value="${esc(i.name)}"></option>`).join("");
  $("manager-favourites").innerHTML=members.map(m=>`
    <label class="manager-favourite">
      <input type="checkbox" value="${m.id}">
      <span>${esc(m.avatar_emoji||"👤")} ${esc(m.display_name)}</span>
    </label>`).join("");

  if(categories.some(c=>c.name===selectedCategory))$("manager-category").value=selectedCategory;
  if(members.some(m=>m.id===selectedOwner))$("manager-owner").value=selectedOwner;
}

function renderManagerLibrary(){
  if(!$("manager-recipe-list"))return;
  const q=$("manager-search").value.trim().toLowerCase();
  const filter=$("manager-filter").value;
  const list=recipes.filter(r=>{
    const matches=!q||[r.title,r.category,r.story].join(" ").toLowerCase().includes(q);
    const structured=recipeIsStructured(r.id);
    return matches&&(filter==="all"||(filter==="structured"&&structured)||(filter==="legacy"&&!structured));
  });

  $("manager-recipe-list").innerHTML=list.length?list.map(r=>{
    const structured=recipeIsStructured(r.id);
    return `<button class="manager-recipe-button ${managerCurrentRecipe?.id===r.id?"active":""}" data-manager-recipe="${r.id}">
      <span class="emoji">${esc(r.emoji||"🍽️")}</span>
      <span class="manager-recipe-copy">
        <strong>${esc(r.title)}</strong>
        <small>${esc(r.category||"Uncategorised")} · ${structured?"Structured":"Needs conversion"}</small>
      </span>
      <span class="manager-status-dot ${structured?"structured":""}"></span>
    </button>`;
  }).join(""):'<p class="muted" style="padding:16px">No recipes found.</p>';

  document.querySelectorAll("[data-manager-recipe]").forEach(b=>b.onclick=()=>managerOpenRecipe(b.dataset.managerRecipe));
}

function managerClearForm(){
  $("manager-form").reset();
  $("manager-recipe-id").value="";
  $("manager-ingredient-rows").innerHTML="";
  $("manager-legacy-preview").hidden=true;
  $("manager-legacy-lines").innerHTML="";
  $("manager-import-legacy").hidden=true;
  $("manager-save-message").textContent="";
  document.querySelectorAll("#manager-favourites input").forEach(x=>x.checked=false);
}

function managerSetFormat(text,structured){
  $("manager-format").textContent=text;
  $("manager-format").classList.toggle("structured",structured);
}

function managerOpenNew(){
  managerCurrentRecipe=null;
  managerClearForm();
  $("manager-empty").hidden=true;
  $("manager-form").hidden=false;
  $("manager-mode").textContent="New recipe";
  $("manager-editor-title").textContent="Recipe details";
  managerSetFormat("Structured recipe",true);
  managerAddIngredientRow();
  renderManagerLibrary();
}

function managerCloseEditor(){
  managerCurrentRecipe=null;
  $("manager-form").hidden=true;
  $("manager-empty").hidden=false;
  renderManagerLibrary();
}

function managerOpenRecipe(id){
  const r=recipes.find(x=>x.id===id);
  if(!r)return;
  managerCurrentRecipe=r;
  managerClearForm();
  $("manager-empty").hidden=true;
  $("manager-form").hidden=false;
  $("manager-recipe-id").value=r.id;
  $("manager-title").value=r.title||"";
  $("manager-emoji").value=r.emoji||"";
  $("manager-category").value=r.category||"";
  $("manager-owner").value=r.owner_member_id||"";
  $("manager-servings").value=r.base_servings??managerNumeric(r.serves)??"";
  $("manager-prep").value=r.prep||"";
  $("manager-cook").value=r.cook||"";
  $("manager-story").value=r.story||"";
  $("manager-source-type").value=r.source_type||"";
  $("manager-source-name").value=r.source_name||"";
  $("manager-method").value=managerLineArray(r.method).join("\n");
  $("manager-tips").value=managerLineArray(r.tips).join("\n");

  const favs=favouritesForRecipe(r.id);
  document.querySelectorAll("#manager-favourites input").forEach(x=>x.checked=favs.has(x.value));

  const rows=structuredForRecipe(r.id);
  if(rows.length){
    rows.forEach(managerAddIngredientRow);
    managerSetFormat("Structured",true);
  }else{
    managerAddIngredientRow();
    const legacy=managerLineArray(r.ingredients);
    $("manager-import-legacy").hidden=!legacy.length;
    $("manager-legacy-preview").hidden=!legacy.length;
    $("manager-legacy-lines").innerHTML=legacy.map(x=>`<li>${esc(x)}</li>`).join("");
    managerSetFormat("Classic format · conversion available",false);
  }

  $("manager-mode").textContent="Editing recipe";
  $("manager-editor-title").textContent=r.title;
  renderManagerLibrary();
}

function managerAddIngredientRow(data={}){
  const fragment=$("manager-ingredient-template").content.cloneNode(true);
  const row=fragment.querySelector(".manager-ingredient-row");
  row.querySelector(".mi-qty").value=data.quantity??data.display_quantity??"";
  row.querySelector(".mi-unit").value=data.unit||"";
  row.querySelector(".mi-name").value=data.ingredient_name||data.name||"";
  row.querySelector(".mi-shop").value=data.shopping_destination||data.default_destination||"woolworths";
  row.querySelector(".mi-remove").onclick=()=>{
    row.remove();
    if(!$("manager-ingredient-rows").children.length)managerAddIngredientRow();
  };
  $("manager-ingredient-rows").appendChild(fragment);
}

function managerGuessDestination(name){
  return /(apple|banana|orange|lemon|lime|onion|garlic|carrot|potato|leek|capsicum|zucchini|spinach|lettuce|tomato|parsley|coriander|basil|celery|mushroom|broccoli|cauliflower|cucumber|avocado)/i.test(name)
    ?"fruit_veg":"woolworths";
}

function managerParseLegacy(line){
  const cleaned=String(line).trim().replace(/^[✓•\-]\s*/,"");
  const match=cleaned.match(/^(\d+(?:[.,]\d+)?|\d+\s*\/\s*\d+|½|¼|¾)\s*(kg|g|ml|l|tsp|tbsp|cups?|cloves?|tins?|packets?|bunch(?:es)?|slices?)?\s+(.+)$/i);
  if(!match)return {quantity:"",unit:"",name:cleaned};
  let qty=match[1].replace(/\s/g,"").replace(",",".");
  const fractions={"½":"0.5","¼":"0.25","¾":"0.75"};
  qty=fractions[qty]||qty;
  if(qty.includes("/")){
    const [a,b]=qty.split("/").map(Number);
    qty=b?a/b:qty;
  }
  const name=match[3].replace(/,\s*(finely |roughly )?(chopped|sliced|diced|crushed).*$/i,"").trim();
  return {quantity:qty,unit:match[2]||"",name};
}

$("manager-import-legacy").onclick=()=>{
  if(!managerCurrentRecipe)return;
  const legacy=managerLineArray(managerCurrentRecipe.ingredients);
  if(!legacy.length)return;
  $("manager-ingredient-rows").innerHTML="";
  legacy.forEach(line=>{
    const parsed=managerParseLegacy(line);
    const known=masterIngredients.find(i=>managerNormalized(i.name)===managerNormalized(parsed.name));
    managerAddIngredientRow({
      quantity:parsed.quantity,
      unit:parsed.unit,
      ingredient_name:parsed.name,
      shopping_destination:known?.default_destination||managerGuessDestination(parsed.name)
    });
  });
  managerSetFormat("Conversion draft · review before saving",false);
  $("manager-import-legacy").hidden=true;
};

function managerCollectRows(){
  return [...document.querySelectorAll(".manager-ingredient-row")].map((row,index)=>({
    quantity:row.querySelector(".mi-qty").value.trim(),
    unit:row.querySelector(".mi-unit").value,
    name:row.querySelector(".mi-name").value.trim(),
    destination:row.querySelector(".mi-shop").value,
    sort_order:index+1
  })).filter(x=>x.name);
}

async function managerEnsureIngredient(row){
  const existing=masterIngredients.find(i=>managerNormalized(i.name)===managerNormalized(row.name));
  if(existing)return existing;

  const {data,error}=await db.from("ingredients")
    .insert({name:row.name,default_destination:row.destination})
    .select().single();

  if(error){
    if(error.code==="23505"){
      const {data:found,error:findError}=await db.from("ingredients")
        .select("*").eq("normalized_name",managerNormalized(row.name)).single();
      if(findError)throw findError;
      return found;
    }
    throw error;
  }
  masterIngredients.push(data);
  return data;
}

$("manager-form").addEventListener("submit",async e=>{
  e.preventDefault();
  $("manager-save-message").textContent="Saving recipe…";
  const rows=managerCollectRows();
  if(!rows.length){
    $("manager-save-message").textContent="Add at least one ingredient.";
    return;
  }

  const recipePayload={
    title:$("manager-title").value.trim(),
    emoji:$("manager-emoji").value.trim()||"🍽️",
    category:$("manager-category").value,
    owner_member_id:$("manager-owner").value||null,
    base_servings:managerNumeric($("manager-servings").value),
    serves:$("manager-servings").value.trim(),
    prep:$("manager-prep").value.trim(),
    cook:$("manager-cook").value.trim(),
    story:$("manager-story").value.trim(),
    source_type:$("manager-source-type").value||null,
    source_name:$("manager-source-name").value.trim()||null,
    method:managerLineArray($("manager-method").value),
    tips:managerLineArray($("manager-tips").value),
    updated_at:new Date().toISOString()
  };

  try{
    let recipeId=$("manager-recipe-id").value;
    if(recipeId){
      const {error}=await db.from("recipes").update(recipePayload).eq("id",recipeId);
      if(error)throw error;
    }else{
      const {data,error}=await db.from("recipes")
        .insert({...recipePayload,ingredients:[]})
        .select().single();
      if(error)throw error;
      recipeId=data.id;
      $("manager-recipe-id").value=recipeId;
    }

    const structured=[];
    for(const row of rows){
      const ingredient=await managerEnsureIngredient(row);
      structured.push({
        recipe_id:recipeId,
        ingredient_id:ingredient.id,
        quantity:managerNumeric(row.quantity),
        display_quantity:managerNumeric(row.quantity)===null?(row.quantity||null):null,
        unit:row.unit||null,
        destination_override:row.destination===ingredient.default_destination?null:row.destination,
        sort_order:row.sort_order
      });
    }

    const {error:deleteError}=await db.from("recipe_ingredients").delete().eq("recipe_id",recipeId);
    if(deleteError)throw deleteError;
    const {error:insertError}=await db.from("recipe_ingredients").insert(structured);
    if(insertError)throw insertError;

    const selected=[...document.querySelectorAll("#manager-favourites input:checked")].map(x=>x.value);
    const {error:fDelete}=await db.from("recipe_favourites").delete().eq("recipe_id",recipeId);
    if(fDelete)throw fDelete;
    if(selected.length){
      const {error:fInsert}=await db.from("recipe_favourites")
        .insert(selected.map(family_member_id=>({recipe_id:recipeId,family_member_id})));
      if(fInsert)throw fInsert;
    }

    $("manager-save-message").textContent="Recipe saved in the V2 structured format.";
    $("manager-save-message").style.color="var(--forest)";
    managerCurrentRecipe={id:recipeId};
    await loadPublicData();
    managerOpenRecipe(recipeId);
  }catch(error){
    $("manager-save-message").style.color="var(--danger)";
    $("manager-save-message").textContent=error.message||String(error);
  }
});

$("plan-week-button").onclick=()=>setPage("planner");
$("choose-tonight-button").onclick=()=>setPage("planner");
init();
