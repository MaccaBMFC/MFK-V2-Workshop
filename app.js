
const cfg=window.MACCA_CONFIG||{};
const configured=cfg.SUPABASE_URL&&!cfg.SUPABASE_URL.startsWith("PASTE_")&&cfg.SUPABASE_PUBLISHABLE_KEY&&!cfg.SUPABASE_PUBLISHABLE_KEY.startsWith("PASTE_");
const db=configured?window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_PUBLISHABLE_KEY):null;
const $=id=>document.getElementById(id);
let recipes=[],categories=[],members=[],shoppingLists=[],shoppingItems=[],activeCategory="All",activeShopping="woolworths",currentUser=null;

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
  const [r,c,m]=await Promise.all([
    db.from("recipes").select("*").eq("is_archived",false).order("title"),
    db.from("categories").select("*").order("sort_order").order("name"),
    db.from("family_members").select("*").eq("is_active",true).order("sort_order")
  ]);
  const error=[r,c,m].find(x=>x.error)?.error;
  if(error){$("recipe-status").hidden=false;$("recipe-status").textContent=error.message;return}
  recipes=r.data||[];categories=c.data||[];members=m.data||[];
  $("settings-category-count").textContent=categories.length;$("settings-member-count").textContent=members.length;
  renderFilters();renderRecipes();
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

$("plan-week-button").onclick=()=>setPage("planner");
$("choose-tonight-button").onclick=()=>setPage("planner");
init();
