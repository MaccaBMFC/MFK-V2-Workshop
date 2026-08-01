
const cfg=window.MACCA_CONFIG||{};
const configured=cfg.SUPABASE_URL&&!cfg.SUPABASE_URL.startsWith("PASTE_")&&cfg.SUPABASE_PUBLISHABLE_KEY&&!cfg.SUPABASE_PUBLISHABLE_KEY.startsWith("PASTE_");
const db=configured?window.supabase.createClient(
  cfg.SUPABASE_URL,
  cfg.SUPABASE_PUBLISHABLE_KEY,
  {
    auth:{
      persistSession:true,
      autoRefreshToken:true,
      detectSessionInUrl:true,
      storage:window.localStorage,
      storageKey:"mfk-auth-v1",
      flowType:"pkce"
    }
  }
):null;
const $=id=>document.getElementById(id);
let recipes=[],categories=[],members=[],shoppingLists=[],shoppingItems=[],masterIngredients=[],structuredRows=[],recipeFavourites=[],activeCategory="All",activeShopping="woolworths",currentUser=null,managerCurrentRecipe=null,plannerWeekStart=null,plannerPlan=null,plannerDaysData=[],plannerEditingDate=null,plannerSelectedType="recipe",plannerSelectedRecipeId=null,plannerPickerCategory="All",plannerPickerMember="All",homeCurrentPlan=null,homeCurrentDays=[],cookSession=null,cookWakeLock=null,cookTimerInterval=null,cookTimerEnd=null,cookSelectedRating=0,cookLogs=[],activeCookSession=null,cookSessionSaveTimer=null;

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

$("settings-sign-in-button").onclick=showLogin;
$("settings-sign-out-button").onclick=signOutOfMFK;
$("settings-clear-cache-button").onclick=async()=>{
  $("settings-sync-status").textContent="Refreshing app cache…";
  if("serviceWorker" in navigator){
    const registrations=await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map(r=>r.update()));
  }
  $("settings-sync-status").textContent=currentUser
    ?"Cache refreshed · Cloud sync connected"
    :"Cache refreshed · Sign in to sync";
  setTimeout(()=>location.reload(),350);
};

async function signOutOfMFK(){
  if(!db)return;
  await db.auth.signOut();
  currentUser=null;
  activeCookSession=null;
  cookSession=null;
  applySession();
  await loadPrivateData();
  await refreshSmartHome();
}
$("sign-out-button").onclick=signOutOfMFK;
document.querySelectorAll("[data-close-dialog]").forEach(b=>b.onclick=()=>$(b.dataset.closeDialog).close());

$("login-form").addEventListener("submit",async e=>{
  e.preventDefault();$("login-message").textContent="Signing in…";
  const {data,error}=await db.auth.signInWithPassword({email:$("login-email").value.trim(),password:$("login-password").value});
  if(error){$("login-message").textContent=error.message;return}
  currentUser=data.user;$("login-message").textContent="";$("login-dialog").close();applySession();await loadPrivateData();await plannerOpenWeek(plannerWeekStart||new Date());
});
function applySession(){
  const signedIn=!!currentUser;
  $("sign-in-button").hidden=signedIn;
  $("sign-out-button").hidden=!signedIn;
  $("user-label").textContent=currentUser?.email||"";

  if($("settings-account-email")){
    $("settings-account-email").textContent=currentUser?.email||"Not signed in";
    $("settings-account-name").textContent=signedIn?"MFK connected":"MFK account";
    $("settings-sync-status").textContent=signedIn?"Cloud sync connected":"Sign in to sync planning, shopping and cooking";
    $("settings-sync-dot").classList.toggle("connected",signedIn);
    $("settings-sync-dot").classList.toggle("signed-out",!signedIn);
    $("settings-sign-in-button").hidden=signedIn;
    $("settings-sign-out-button").hidden=!signedIn;
  }
}

async function init(){
  const requested=location.hash.replace("#","")||"today";
  if(["today","planner","recipes","shopping","settings"].includes(requested))setPage(requested);
  if(!db){
    $("recipe-status").hidden=false;
    $("recipe-status").textContent="Supabase is not connected. Copy your existing config.js into this repository.";
    return;
  }

  const {data:{session},error}=await db.auth.getSession();
  if(error)console.warn("MFK session restore:",error);
  currentUser=session?.user||null;
  applySession();

  await Promise.all([loadPublicData(),loadPrivateData()]);
  plannerSetWeek(new Date());
  await plannerOpenWeek(plannerWeekStart);
  await refreshSmartHome();

  db.auth.onAuthStateChange((event,nextSession)=>{
    window.setTimeout(async()=>{
      const nextUser=nextSession?.user||null;
      const userChanged=nextUser?.id!==currentUser?.id;
      currentUser=nextUser;
      applySession();

      if(["SIGNED_IN","SIGNED_OUT","USER_UPDATED"].includes(event)||userChanged){
        await loadPrivateData();
        await plannerOpenWeek(plannerWeekStart||new Date());
        await refreshSmartHome();
      }
    },0);
  });
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
  shoppingLists=l.data||[];shoppingItems=i.data||[];renderShopping();renderShoppingCounts();await Promise.all([loadCookLogs(),loadActiveCookSession()]);refreshSmartHome();
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
  const woolId=getListId("woolworths"),fruitId=getListId("fruit_veg"),pantryId=getListId("pantry");
  const woolCount=shoppingItems.filter(x=>x.shopping_list_id===woolId&&!x.is_checked).length;
  const fruitCount=shoppingItems.filter(x=>x.shopping_list_id===fruitId&&!x.is_checked).length;
  const pantryCount=shoppingItems.filter(x=>x.shopping_list_id===pantryId&&!x.is_checked).length;
  $("woolies-count").textContent=woolCount===0?"Complete":woolCount;
  $("fruit-count").textContent=fruitCount===0?"Complete":fruitCount;
  $("pantry-count").textContent=pantryCount===0?"Complete":pantryCount;
  $("tab-count-woolworths").textContent=woolCount;
  $("tab-count-fruit_veg").textContent=fruitCount;
  $("tab-count-pantry").textContent=pantryCount;
  ["woolies-count","fruit-count","pantry-count"].forEach(id=>{
    const el=$(id);const small=el?.closest("small");
    if(small)small.lastChild.textContent=el.textContent==="Complete"?"":" items";
  });
}
function renderShopping(){
  if(!currentUser){
    $("shopping-list-content").innerHTML='<div class="empty-state"><span>🔐</span><h2>Sign in to use shopping</h2><p>Your lists are private to signed-in family accounts.</p></div>';
    return;
  }

  const list=activeItems();
  const manual=list.filter(x=>x.source_type==="manual");
  const generated=list.filter(x=>x.source_type==="meal_plan");

  const renderGroup=(title,items,sourceClass)=>{
    if(!items.length)return "";
    return `<section class="shopping-group">
      <div class="shopping-group-heading"><h3>${title}</h3><span>${items.length} item${items.length===1?"":"s"}</span></div>
      ${items.map(x=>{
        const quantity=[formatShoppingQuantity(x.quantity,x.unit),x.display_quantity,displayShoppingUnit(x.unit,x.quantity)].filter(Boolean).join(" ");
        return `<div class="shopping-item-row ${sourceClass==="manual"?"manual-row":""}">
          <input type="checkbox" data-shopping-check="${x.id}" ${x.is_checked?"checked":""}>
          <span class="shopping-item-copy ${x.is_checked?"checked":""}">
            <strong>${esc([quantity,x.item_name].filter(Boolean).join(" "))}</strong>
            ${x.notes?`<small>${esc(x.notes)}</small>`:""}
          </span>
          <span class="shopping-source-pill ${sourceClass}">${sourceClass==="manual"?"Manual":"Meal plan"}</span>
          ${sourceClass==="manual"?`<button class="manual-delete-button" type="button" data-delete-manual="${x.id}" aria-label="Delete ${esc(x.item_name)}">🗑️</button>`:""}
        </div>`;
      }).join("")}
    </section>`;
  };

  $("shopping-list-content").innerHTML=
    renderGroup("Added manually",manual,"manual")+
    renderGroup("From this week's meals",generated,"generated")||
    '<div class="empty-state"><span>🧺</span><h2>No items yet</h2><p>Add items manually, or generate them from the meal planner.</p></div>';

  document.querySelectorAll("[data-shopping-check]").forEach(c=>c.onchange=async()=>{
    const {error}=await db.from("shopping_items").update({is_checked:c.checked}).eq("id",c.dataset.shoppingCheck);
    if(!error){
      const item=shoppingItems.find(x=>x.id===c.dataset.shoppingCheck);
      if(item)item.is_checked=c.checked;
      renderShopping();renderShoppingCounts();
    }
  });
  document.querySelectorAll("[data-delete-manual]").forEach(b=>b.onclick=async()=>{
    const item=shoppingItems.find(x=>x.id===b.dataset.deleteManual);
    if(!item||item.source_type!=="manual")return;
    if(!confirm(`Delete "${item.item_name}" from the list?`))return;
    const {error}=await db.from("shopping_items").delete().eq("id",item.id).eq("source_type","manual");
    if(error){alert(error.message);return}
    shoppingItems=shoppingItems.filter(x=>x.id!==item.id);
    renderShopping();renderShoppingCounts();
  });
}

function fractionGlyph(value){
  const rounded=Math.round(Number(value)*4)/4;
  const whole=Math.floor(rounded);
  const fraction=Math.round((rounded-whole)*4);
  const glyph={1:"¼",2:"½",3:"¾"}[fraction]||"";
  return `${whole||""}${glyph}`||"0";
}
function formatShoppingQuantity(value,unit=""){
  if(value===null||value===undefined||value==="")return "";
  const n=Number(value);
  if(!Number.isFinite(n))return String(value);

  const u=normaliseShoppingUnit(unit);
  if(["cup","tbsp","tsp"].includes(u))return fractionGlyph(n);
  if(Number.isInteger(n))return String(n);
  return String(Math.round(n*100)/100).replace(/\.0+$/,"");
}



/* =========================================================
   MFK v1.3.0 RC1 — COOKING INTELLIGENCE
========================================================= */

async function loadCookLogs(){
  if(!currentUser){cookLogs=[];return}
  const {data,error}=await db.from("recipe_cook_logs")
    .select("*").order("cooked_on",{ascending:false}).order("created_at",{ascending:false});
  if(error){console.error(error);cookLogs=[];return}
  cookLogs=data||[];
}

async function loadActiveCookSession(){
  if(!currentUser){activeCookSession=null;renderResumeCooking();return}
  const {data,error}=await db.from("active_cook_sessions")
    .select("*").eq("auth_user_id",currentUser.id).maybeSingle();
  if(error){console.error("Active cooking session:",error);activeCookSession=null}
  else activeCookSession=data||null;
  renderResumeCooking();
}

function recipeSteps(recipeId){
  return managerLineArray(recipes.find(r=>r.id===recipeId)?.method);
}

function renderResumeCooking(){
  const card=$("resume-cooking-card");
  if(!card)return;
  if(!currentUser||!activeCookSession||activeCookSession.status==="completed"){
    card.hidden=true;return;
  }
  const recipe=recipes.find(r=>r.id===activeCookSession.recipe_id);
  const steps=recipeSteps(activeCookSession.recipe_id);
  if(!recipe||!steps.length){card.hidden=true;return}
  const step=Math.min(Number(activeCookSession.current_step||0)+1,steps.length);
  const started=new Date(activeCookSession.started_at);
  const stale=started.toDateString()!==new Date().toDateString();
  card.hidden=false;
  card.classList.toggle("active-session-stale",stale);
  $("resume-cooking-title").textContent=`Resume ${recipe.title}`;
  $("resume-cooking-detail").textContent=`Step ${step} of ${steps.length}${stale?" · Started earlier":""}`;
}

$("resume-cooking-button").onclick=async()=>{
  if(!activeCookSession)return loadActiveCookSession();
  await startCookMode(activeCookSession.recipe_id,activeCookSession.servings,true);
};

function scaledRecipeIngredients(recipeId,servings){
  const recipe=recipes.find(r=>r.id===recipeId);
  const base=Number(recipe?.base_servings||recipe?.serves||servings||1);
  const factor=base>0?Number(servings||base)/base:1;
  return structuredRows.filter(x=>x.recipe_id===recipeId).map(row=>({
    ...row,scaledQuantity:row.quantity===null?null:roundScaledQuantity(Number(row.quantity)*factor,row.unit,row.ingredient_name)
  }));
}

async function createOrReplaceCookSession(recipeId,servings,mealPlanDayId=null){
  if(!currentUser)throw new Error("Sign in before starting Cook Mode.");
  const payload={
    auth_user_id:currentUser.id,recipe_id:recipeId,meal_plan_day_id:mealPlanDayId,
    servings:Number(servings||1),current_step:0,status:"active",started_at:new Date().toISOString(),last_activity_at:new Date().toISOString()
  };
  const {data,error}=await db.from("active_cook_sessions").upsert(payload,{onConflict:"auth_user_id"}).select().single();
  if(error)throw error;
  activeCookSession=data;return data;
}

async function persistCookStep(immediate=false){
  if(!cookSession||!currentUser)return;
  const save=async()=>{
    const {data,error}=await db.from("active_cook_sessions").update({
      current_step:cookSession.stepIndex,status:"active",last_activity_at:new Date().toISOString()
    }).eq("auth_user_id",currentUser.id).select().maybeSingle();
    if(error)console.error("Could not save cooking step:",error);
    else if(data)activeCookSession=data;
  };
  clearTimeout(cookSessionSaveTimer);
  if(immediate)await save(); else cookSessionSaveTimer=setTimeout(save,250);
}

async function deleteActiveCookSession(){
  clearTimeout(cookSessionSaveTimer);
  if(currentUser){
    const {error}=await db.from("active_cook_sessions").delete().eq("auth_user_id",currentUser.id);
    if(error)throw error;
  }
  activeCookSession=null;cookSession=null;renderResumeCooking();
}

async function startCookMode(recipeId,servings=null,resume=false){
  const recipe=recipes.find(r=>r.id===recipeId);if(!recipe)return false;
  const steps=recipeSteps(recipeId);if(!steps.length){alert("This recipe has no method steps yet.");return false}
  try{
    if(!resume&&activeCookSession&&activeCookSession.recipe_id!==recipeId){
      const oldRecipe=recipes.find(r=>r.id===activeCookSession.recipe_id);
      if(!confirm(`Replace your active ${oldRecipe?.title||"cooking"} session with ${recipe.title}?`))return false;
    }
    let session=activeCookSession;
    if(!resume||!session||session.recipe_id!==recipeId){
      const todayEntry=homeDateEntry(homeCurrentDays,new Date());
      session=await createOrReplaceCookSession(recipeId,Number(servings||recipe.base_servings||recipe.serves||1),todayEntry?.id||null);
    }else{
      const {data,error}=await db.from("active_cook_sessions").update({status:"active",last_activity_at:new Date().toISOString()})
        .eq("auth_user_id",currentUser.id).select().single();
      if(error)throw error;session=data;activeCookSession=data;
    }
    cookSession={
      recipeId,servings:Number(session.servings||servings||recipe.base_servings||recipe.serves||1),
      stepIndex:resume?Number(session.current_step||0):0,startedAt:session.started_at,sessionId:session.id,completed:false
    };
    $("resume-cooking-card").hidden=true;
    $("cook-exit-overlay").hidden=true;$("cook-finish-overlay").hidden=true;
    $("cook-mode-title").textContent=recipe.title;
    $("cook-mode-subtitle").textContent=`Cooking for ${cookSession.servings} · ${recipe.prep||"—"} prep · ${recipe.cook||"—"} cook`;
    renderCookIngredients();renderCookStep();
    if(!$("cook-mode-dialog").open)$("cook-mode-dialog").showModal();
    await requestCookWakeLock();try{await screen.orientation?.lock?.("portrait")}catch{}
    return true;
  }catch(error){alert(error.message||String(error));await loadActiveCookSession();return false}
}

function renderCookIngredients(){
  if(!cookSession)return;
  const rows=scaledRecipeIngredients(cookSession.recipeId,cookSession.servings);
  $("cook-scaled-ingredients").innerHTML=rows.length?`<ul>${rows.map(x=>{
    const qty=x.scaledQuantity??x.display_quantity??"";
    return `<li>${esc([qty,x.unit,x.ingredient_name].filter(v=>v!==null&&v!=="").join(" "))}</li>`;
  }).join("")}</ul>`:'<p class="muted">Structured ingredients are not available for this recipe yet.</p>';
}

function renderCookStep(){
  if(!cookSession)return;
  const steps=recipeSteps(cookSession.recipeId);if(!steps.length)return;
  cookSession.stepIndex=Math.min(Math.max(0,cookSession.stepIndex),steps.length-1);
  const step=steps[cookSession.stepIndex],number=cookSession.stepIndex+1,percent=Math.round(number/steps.length*100);
  $("cook-step-label").textContent=`Step ${number} of ${steps.length}`;$("cook-progress-percent").textContent=`${percent}%`;
  $("cook-progress-bar").style.width=`${percent}%`;$("cook-step-number").textContent=number;$("cook-step-text").textContent=step;
  $("cook-prev-step").disabled=cookSession.stepIndex===0;$("cook-next-step").textContent=cookSession.stepIndex===steps.length-1?"Finish Cooking 🎉":"Next →";
  const timer=detectTimerFromStep(step);$("cook-timer-suggestion").hidden=!timer;
  if(timer){$("cook-timer-label").textContent=`⏲ ${timer.label}`;$("start-step-timer").dataset.seconds=timer.seconds;$("start-step-timer").dataset.label=timer.label}
  persistCookStep();
}

function detectTimerFromStep(text){
  const match=String(text||"").match(/(\d+(?:\.\d+)?)\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)/i);if(!match)return null;
  const amount=Number(match[1]),unit=match[2].toLowerCase();let seconds=amount;
  if(unit.startsWith("min"))seconds*=60;if(unit.startsWith("hour")||unit.startsWith("hr"))seconds*=3600;
  return {seconds:Math.round(seconds),label:`${match[1]} ${match[2]}`};
}

$("cook-prev-step").onclick=()=>{if(cookSession?.stepIndex>0){cookSession.stepIndex--;renderCookStep()}};
$("cook-next-step").onclick=()=>{
  if(!cookSession)return;const steps=recipeSteps(cookSession.recipeId);
  if(cookSession.stepIndex>=steps.length-1){showCookFinishOverlay();return}
  cookSession.stepIndex++;renderCookStep();
};
$("toggle-cook-ingredients").onclick=()=>{const panel=$("cook-scaled-ingredients");panel.hidden=!panel.hidden};
$("cook-mode-exit").onclick=async()=>{await persistCookStep(true);$("cook-exit-overlay").hidden=false};
$("cook-exit-cancel").onclick=()=>{$("cook-exit-overlay").hidden=true};
$("cook-resume-later").onclick=async()=>{
  try{
    await persistCookStep(true);
    const {data,error}=await db.from("active_cook_sessions").update({status:"paused",last_activity_at:new Date().toISOString()})
      .eq("auth_user_id",currentUser.id).select().single();if(error)throw error;activeCookSession=data;
    $("cook-exit-overlay").hidden=true;$("cook-mode-dialog").close();await releaseCookWakeLock();setPage("today");renderResumeCooking();await refreshSmartHome();
  }catch(error){alert(error.message||String(error))}
};
$("cook-finish-now").onclick=()=>{showCookFinishOverlay()};
$("cook-stop-now").onclick=async()=>{
  try{
    clearInterval(cookTimerInterval);cookTimerInterval=null;cookTimerEnd=null;$("active-timer-card").hidden=true;
    await deleteActiveCookSession();$("cook-exit-overlay").hidden=true;$("cook-mode-dialog").close();await releaseCookWakeLock();setPage("today");await refreshSmartHome();
  }catch(error){alert(error.message||String(error))}
};

async function requestCookWakeLock(){
  if(!("wakeLock" in navigator)){ $("wake-lock-status").textContent="📱 Keep screen awake unavailable";return }
  try{cookWakeLock=await navigator.wakeLock.request("screen");$("wake-lock-status").textContent="📱 Screen staying awake";
    cookWakeLock.addEventListener("release",()=>{$("wake-lock-status").textContent="📱 Screen awake released"})}
  catch{$("wake-lock-status").textContent="📱 Keep screen awake unavailable"}
}
async function releaseCookWakeLock(){try{await cookWakeLock?.release()}catch{}cookWakeLock=null;try{screen.orientation?.unlock?.()}catch{}}
document.addEventListener("visibilitychange",async()=>{if(document.visibilityState==="visible"&&$("cook-mode-dialog")?.open&&!cookWakeLock)await requestCookWakeLock()});

$("start-step-timer").onclick=()=>{const seconds=Number($("start-step-timer").dataset.seconds||0);if(seconds>0)startCookTimer(seconds,$("start-step-timer").dataset.label)};
function startCookTimer(seconds,label){clearInterval(cookTimerInterval);cookTimerEnd=Date.now()+seconds*1000;$("active-timer-card").hidden=false;$("active-timer-step").textContent=label||"Cooking timer";updateCookTimer();cookTimerInterval=setInterval(updateCookTimer,1000)}
function updateCookTimer(){
  const remaining=Math.max(0,Math.ceil((cookTimerEnd-Date.now())/1000)),mins=Math.floor(remaining/60),secs=remaining%60;
  $("active-timer-display").textContent=`${String(mins).padStart(2,"0")}:${String(secs).padStart(2,"0")}`;
  if(remaining<=0){clearInterval(cookTimerInterval);cookTimerInterval=null;$("active-timer-display").textContent="DONE";try{navigator.vibrate?.([250,150,250,150,500])}catch{};alert("⏲️ Timer finished!")}
}
$("cancel-active-timer").onclick=()=>{clearInterval(cookTimerInterval);cookTimerInterval=null;cookTimerEnd=null;$("active-timer-card").hidden=true};

function showCookFinishOverlay(){
  if(!cookSession)return;$("cook-exit-overlay").hidden=true;$("cook-finish-overlay").hidden=false;
  cookSelectedRating=0;$("session-finish-note").value="";$("session-finish-message").textContent="";renderSessionRating();
}
function renderSessionRating(){document.querySelectorAll("[data-session-rating]").forEach(b=>b.classList.toggle("active",Number(b.dataset.sessionRating)<=cookSelectedRating))}
document.querySelectorAll("[data-session-rating]").forEach(b=>b.onclick=()=>{cookSelectedRating=Number(b.dataset.sessionRating);renderSessionRating()});

async function completeCook(saveNote=true){
  if(!cookSession)return;
  $("session-finish-message").textContent="Saving your cook…";
  try{
    const payload={recipe_id:cookSession.recipeId,cooked_on:plannerIso(new Date()),servings_cooked:cookSession.servings||null,
      notes:saveNote?($("session-finish-note").value.trim()||null):null,rating:cookSelectedRating||null};
    const {error}=await db.from("recipe_cook_logs").insert(payload);if(error)throw error;
    await deleteActiveCookSession();await loadCookLogs();clearInterval(cookTimerInterval);cookTimerInterval=null;cookTimerEnd=null;
    $("active-timer-card").hidden=true;$("cook-finish-overlay").hidden=true;$("cook-mode-dialog").close();await releaseCookWakeLock();setPage("today");await refreshSmartHome();
  }catch(error){$("session-finish-message").textContent=error.message||String(error)}
}
$("session-finish-save").onclick=()=>completeCook(true);$("session-finish-home").onclick=()=>completeCook(false);

async function openKitchenAnalytics(){if(!currentUser){showLogin();return}await loadCookLogs();renderKitchenAnalytics();$("kitchen-analytics-dialog").showModal()}
$("open-kitchen-analytics").onclick=openKitchenAnalytics;
function renderKitchenAnalytics(){
  const total=cookLogs.length,thisMonth=cookLogs.filter(x=>{const d=new Date(`${x.cooked_on}T00:00:00`),now=new Date();return d.getMonth()===now.getMonth()&&d.getFullYear()===now.getFullYear()}).length;
  const rated=cookLogs.filter(x=>Number(x.rating)>0),avgRating=rated.length?(rated.reduce((a,x)=>a+Number(x.rating),0)/rated.length).toFixed(1):"—";
  const avgServes=total?(cookLogs.reduce((a,x)=>a+Number(x.servings_cooked||0),0)/total).toFixed(1):"—";
  $("analytics-metrics").innerHTML=[["Meals cooked",total],["This month",thisMonth],["Average rating",avgRating],["Average serves",avgServes]].map(([label,value])=>`<div class="analytics-metric"><strong>${esc(value)}</strong><span>${esc(label)}</span></div>`).join("");
  const counts=new Map();cookLogs.forEach(log=>counts.set(log.recipe_id,(counts.get(log.recipe_id)||0)+1));
  const most=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5);
  $("analytics-most-cooked").innerHTML=most.length?most.map(([id,count],index)=>{const r=recipes.find(x=>x.id===id);return `<div class="analytics-row"><span class="emoji">${r?.emoji||"🍽️"}</span><span><strong>${esc(r?.title||"Recipe")}</strong><small>${index===0?"Family champion":"Cooked regularly"}</small></span><b>${count}×</b></div>`}).join(""):'<p class="muted">Finish a cooking session to start building history.</p>';
  $("analytics-recent").innerHTML=cookLogs.slice(0,8).map(log=>{const r=recipes.find(x=>x.id===log.recipe_id),stars=log.rating?` · ${"★".repeat(Number(log.rating))}`:"";return `<div class="analytics-row"><span class="emoji">${r?.emoji||"🍽️"}</span><span><strong>${esc(r?.title||"Recipe")}</strong><small>${esc(log.cooked_on)}${stars}${log.notes?` · ${esc(log.notes)}`:""}</small></span><b>👥 ${esc(log.servings_cooked||"—")}</b></div>`}).join("")||'<p class="muted">No completed cooks yet.</p>';
}

/* =========================================================
   SPRINT 3 — SMART HOME SCREEN
========================================================= */

function homeGreeting(){
  const hour=new Date().getHours();
  if(hour<12)return {emoji:"☀️",text:"Good morning"};
  if(hour<17)return {emoji:"🌤️",text:"Good afternoon"};
  return {emoji:"🌙",text:"Good evening"};
}

function homeMealInfo(entry){
  if(!entry)return {
    emoji:"🍽️",
    title:"Nothing planned yet",
    story:"Choose tonight's meal and MFK will take it from there.",
    type:"none",
    button:"Choose a meal"
  };

  if(entry.meal_type==="recipe"){
    const recipe=recipes.find(r=>r.id===entry.recipe_id);
    return {
      emoji:recipe?.emoji||"🍽️",
      title:recipe?.title||"Recipe",
      story:recipe?.story||"Tonight's recipe is ready when you are.",
      type:"recipe",
      recipe,
      servings:entry.planned_servings||recipe?.base_servings||recipe?.serves||"—"
    };
  }

  const specials={
    leftovers:{
      emoji:"🥡",title:"Leftovers tonight",story:"No full cook required — future you planned this beautifully.",type:"leftovers"
    },
    takeaway:{
      emoji:"🍕",title:"Takeaway night",story:"Enjoy the night off. MFK officially approves.",type:"takeaway"
    },
    eating_out:{
      emoji:"🍽️",title:"Eating out tonight",story:"Kitchen closed. Go enjoy yourselves.",type:"eating_out"
    },
    free_night:{
      emoji:"🌙",title:"Free night",story:"No plan, no pressure. See where the evening takes you.",type:"free_night"
    },
    custom:{
      emoji:"✏️",title:entry.custom_meal_name||"Custom meal",story:entry.notes||"Tonight's custom plan is ready.",type:"custom"
    }
  };
  return specials[entry.meal_type]||specials.free_night;
}

function homeDateEntry(days,date){
  const key=plannerIso(date);
  return days.find(x=>x.meal_date===key)||null;
}

async function refreshSmartHome(){
  if(!$("today-greeting")||!db)return;

  const greeting=homeGreeting();
  $("today-greeting").textContent=`${greeting.text}, Macca.`;
  $("today-eyebrow").textContent=`${greeting.emoji} Today`;

  if(!currentUser){
    renderSmartHomeLoggedOut();
    return;
  }

  try{
    const today=new Date();
    const weekStart=plannerSaturday(today);
    const start=plannerIso(weekStart);
    const end=plannerIso(plannerAdd(weekStart,6));

    const {data:plans,error}=await db.from("meal_plans")
      .select("*")
      .eq("start_date",start)
      .eq("end_date",end)
      .limit(1);
    if(error)throw error;

    homeCurrentPlan=plans?.[0]||null;
    homeCurrentDays=[];

    if(homeCurrentPlan){
      const {data:days,error:daysError}=await db.from("meal_plan_days")
        .select("*")
        .eq("meal_plan_id",homeCurrentPlan.id)
        .order("meal_date");
      if(daysError)throw daysError;
      homeCurrentDays=days||[];
    }

    renderSmartHome(today);
  }catch(error){
    $("today-lede").textContent="MFK couldn't load today's kitchen briefing.";
    console.error(error);
  }
}

function renderSmartHomeLoggedOut(){
  $("today-lede").textContent="Sign in for tonight's dinner, this week's plan and your shopping briefing.";
  $("tonight-title").textContent="Sign in to see tonight";
  $("tonight-story").textContent="Your family kitchen briefing is waiting.";
  $("tonight-visual").textContent="🔐";
  $("tonight-meta").hidden=true;
  $("cook-tonight-button").hidden=true;
  $("choose-tonight-button").hidden=false;
  $("week-preview").innerHTML='<div class="empty-state compact"><span>🔐</span><p>Sign in to load your week.</p></div>';
  $("tomorrow-title").textContent="Sign in to see tomorrow";
  $("tomorrow-detail").textContent="Your next meal will appear here.";
  $("tomorrow-emoji").textContent="🔐";
  $("week-status-title").textContent="Sign in required";
  $("week-status-icon").textContent="🔐";
  $("week-readiness-list").innerHTML="";
}

function renderSmartHome(today){
  const tonightEntry=homeDateEntry(homeCurrentDays,today);
  const tomorrowDate=plannerAdd(today,1);
  const tomorrowEntry=homeDateEntry(homeCurrentDays,tomorrowDate);
  let tonight=homeMealInfo(tonightEntry);
  const tomorrow=homeMealInfo(tomorrowEntry);
  const completedTonight=tonightEntry?.meal_type==="recipe"&&cookLogs.some(log=>log.recipe_id===tonightEntry.recipe_id&&log.cooked_on===plannerIso(today));
  if(completedTonight){tonight={...tonight,title:"Dinner complete",story:`${tonight.recipe?.title||"Tonight's meal"} is cooked. Enjoy your evening ❤️`,type:"completed",emoji:"✅"}}

  const tonightCard=document.querySelector(".tonight-card");
  tonightCard.classList.remove("special-night","free-night","leftovers-night","eating-out-night","no-plan");
  if(tonight.type==="takeaway"||tonight.type==="custom")tonightCard.classList.add("special-night");
  if(tonight.type==="free_night")tonightCard.classList.add("free-night");
  if(tonight.type==="leftovers")tonightCard.classList.add("leftovers-night");
  if(tonight.type==="eating_out")tonightCard.classList.add("eating-out-night");
  if(tonight.type==="none")tonightCard.classList.add("no-plan");
  tonightCard.classList.toggle("dinner-complete-card",tonight.type==="completed");

  $("tonight-visual").textContent=tonight.emoji;
  $("tonight-title").textContent=tonight.title;
  $("tonight-story").textContent=tonight.story;
  $("tonight-eyebrow").textContent=tonight.type==="recipe"?"Tonight's dinner":"Tonight";
  $("tonight-meta").hidden=tonight.type!=="recipe";
  $("cook-tonight-button").hidden=tonight.type!=="recipe";
  $("choose-tonight-button").hidden=tonight.type==="recipe"||tonight.type==="completed";

  if(tonight.type==="recipe"){
    $("tonight-meta").innerHTML=`
      <span>👥 Cooking for ${esc(tonight.servings)}</span>
      <span>⏱ Prep ${esc(tonight.recipe?.prep||"—")}</span>
      <span>🔥 Cook ${esc(tonight.recipe?.cook||"—")}</span>`;
    $("cook-tonight-button").dataset.recipeId=tonight.recipe?.id||"";
  }

  $("tomorrow-title").textContent=tomorrow.title;
  $("tomorrow-detail").textContent=tomorrow.type==="recipe"
    ? `Cooking for ${tomorrow.servings} · ${tomorrow.recipe?.prep||"—"} prep`
    : tomorrow.story;
  $("tomorrow-emoji").textContent=tomorrow.emoji;

  renderHomeWeekPreview();
  renderHomeReadiness(today);
  document.querySelector("#page-today .page-shell")?.classList.add("home-ready-pulse");
  setTimeout(()=>document.querySelector("#page-today .page-shell")?.classList.remove("home-ready-pulse"),600);
}

function renderHomeWeekPreview(){
  if(!homeCurrentPlan){
    $("week-preview").innerHTML='<div class="empty-state compact"><span>📅</span><p>No week planned yet.</p></div>';
    return;
  }

  const rows=[];
  for(let i=0;i<7;i++){
    const date=plannerAdd(plannerSaturday(new Date()),i);
    const entry=homeDateEntry(homeCurrentDays,date);
    const meal=homeMealInfo(entry);
    rows.push(`<div class="week-preview-row">
      <span class="week-preview-day">${plannerDay(date).slice(0,3)}</span>
      <span class="week-preview-emoji">${esc(meal.emoji)}</span>
      <span class="week-preview-meal">${esc(meal.title)}</span>
      <span class="week-preview-servings">${entry?.meal_type==="recipe"?`👥 ${esc(entry.planned_servings||"—")}`:""}</span>
    </div>`);
  }
  $("week-preview").innerHTML=`<div class="week-preview-list">${rows.join("")}</div>`;
}

function renderHomeReadiness(today){
  const plannedCount=homeCurrentDays.length;
  const missingCount=Math.max(0,7-plannedCount);
  const generated=!!homeCurrentPlan?.shopping_generated_at;
  const tonightEntry=homeDateEntry(homeCurrentDays,today);
  const weekEnd=plannerAdd(plannerSaturday(today),6);
  const isFriday=today.getDay()===5;

  let title="Week needs a little attention";
  let icon="🧭";

  if(!homeCurrentPlan){
    title="Ready to plan your week";
    icon="📅";
  }else if(missingCount===0&&generated){
    title=isFriday?"Week complete — ready for the next one":"You're ready to cook";
    icon=isFriday?"✅":"🍳";
  }else if(missingCount===0){
    title="Meals planned — shopping is next";
    icon="🛒";
  }

  $("week-status-title").textContent=title;
  $("week-status-icon").textContent=icon;

  const items=[
    {
      ok:!!homeCurrentPlan,
      text:homeCurrentPlan?`${plannedCount} meal${plannedCount===1?"":"s"} planned`:"No saved meal plan"
    },
    {
      ok:missingCount===0,
      text:missingCount===0?"Every day has a plan":`${missingCount} day${missingCount===1?"":"s"} still open`
    },
    {
      ok:generated,
      text:generated?"Shopping lists generated":"Shopping lists not generated yet"
    },
    {
      ok:!!tonightEntry,
      text:tonightEntry?"Tonight is sorted":"Tonight still needs a decision"
    }
  ];

  $("week-readiness-list").innerHTML=items.map(x=>`
    <div class="readiness-item">
      <span>${x.ok?"✅":"○"}</span>
      <strong>${esc(x.text)}</strong>
    </div>`).join("");

  $("plan-week-button").textContent=homeCurrentPlan
    ? (isFriday?"✨ Plan My Week":"✏️ Edit This Week")
    : "✨ Plan My Week";
}

$("cook-tonight-button").onclick=()=>{
  const id=$("cook-tonight-button").dataset.recipeId;
  const todayEntry=homeDateEntry(homeCurrentDays,new Date());
  if(id)startCookMode(id,todayEntry?.planned_servings||null,false);
};

function normaliseShoppingUnit(unit=""){
  const u=String(unit||"").trim().toLowerCase().replace(/\./g,"");
  const aliases={
    "cups":"cup","c":"cup",
    "tablespoon":"tbsp","tablespoons":"tbsp",
    "teaspoon":"tsp","teaspoons":"tsp",
    "grams":"g","gram":"g",
    "kilograms":"kg","kilogram":"kg",
    "millilitres":"ml","milliliters":"ml","millilitre":"ml","milliliter":"ml",
    "litres":"l","liters":"l","litre":"l","liter":"l",
    "cloves":"clove","leaves":"leaf",
    "eggs":"egg","onions":"onion","carrots":"carrot",
    "sticks":"stick","slices":"slice","tins":"tin","cans":"tin",
    "packets":"packet","packs":"packet","bunches":"bunch",
    "fillets":"fillet","cutlets":"cutlet"
  };
  return aliases[u]||u;
}

function displayShoppingUnit(unit="",quantity=null){
  const u=normaliseShoppingUnit(unit);
  if(!u)return "";
  const plural=Number(quantity)!==1;
  const names={
    cup:plural?"cups":"cup",
    tbsp:"tbsp",
    tsp:"tsp",
    g:"g",kg:"kg",ml:"ml",l:"L",
    clove:plural?"cloves":"clove",
    leaf:plural?"leaves":"leaf",
    egg:plural?"eggs":"egg",
    onion:plural?"onions":"onion",
    carrot:plural?"carrots":"carrot",
    stick:plural?"sticks":"stick",
    slice:plural?"slices":"slice",
    tin:plural?"tins":"tin",
    packet:plural?"packets":"packet",
    bunch:plural?"bunches":"bunch",
    fillet:plural?"fillets":"fillet",
    cutlet:plural?"cutlets":"cutlet"
  };
  return names[u]||u;
}

function canonicalIngredientName(name=""){
  let value=String(name).trim().toLowerCase()
    .replace(/[(),]/g," ")
    .replace(/\s+/g," ")
    .replace(/\b(fresh|dried|large|small|medium)\b/g," ")
    .replace(/\s+/g," ")
    .trim();

  const aliases=[
    [/\bcloves? of garlic\b|\bgarlic cloves?\b/g,"garlic"],
    [/\bbay leaves?\b/g,"bay leaf"],
    [/\bbrown onions?\b/g,"brown onion"],
    [/\bonions?\b/g,"onion"],
    [/\bvegetable stock\b|\bveg stock\b/g,"vegetable stock"],
    [/\bchicken stock\b/g,"chicken stock"]
  ];
  for(const [pattern,replacement] of aliases)value=value.replace(pattern,replacement);
  return value.trim();
}

function isCountableShoppingItem(unit,name){
  const u=normaliseShoppingUnit(unit);
  const item=canonicalIngredientName(name);
  const countUnits=new Set([
    "clove","leaf","egg","onion","carrot","stick","slice","tin",
    "packet","bunch","fillet","cutlet","each"
  ]);
  const countNames=/(onion|garlic|bay leaf|carrot|celery|leek|capsicum|apple|banana|orange|lemon|lime|potato|tomato|egg|avocado|zucchini|cucumber|mushroom|fillet|cutlet)$/;
  return countUnits.has(u)||(u===""&&countNames.test(item));
}

function roundScaledQuantity(quantity,unit,ingredientName=""){
  if(quantity===null||quantity===undefined)return null;
  const n=Number(quantity);
  if(!Number.isFinite(n))return null;
  const u=normaliseShoppingUnit(unit);

  if(isCountableShoppingItem(u,ingredientName))return Math.max(1,Math.ceil(n));
  if(["cup","tbsp","tsp"].includes(u))return Math.max(.25,Math.ceil(n*4)/4);

  // Practical supermarket amounts rather than calculator noise.
  if(["g","ml"].includes(u)){
    if(n>=1000)return Math.ceil(n/50)*50;
    if(n>=100)return Math.ceil(n/25)*25;
    return Math.max(5,Math.ceil(n/5)*5);
  }
  if(["kg","l"].includes(u))return Math.ceil(n*10)/10;
  return Math.ceil(n*100)/100;
}

function shoppingMergeKey(row){
  return [
    row.shopping_destination||"woolworths",
    canonicalIngredientName(row.ingredient_name||row.item_name||""),
    normaliseShoppingUnit(row.unit)
  ].join("|");
}

async function generateShoppingLists(){
  if(!currentUser){showLogin();return}
  if(!plannerPlan){
    alert("Save the week before generating shopping lists.");
    return;
  }

  const recipeDays=plannerDaysData.filter(x=>x.meal_type==="recipe"&&x.recipe_id);
  if(!recipeDays.length){
    alert("There are no recipe meals in this week.");
    return;
  }

  $("shopping-generation-status").textContent="Reading recipes and building lists…";
  $("shopping-generation-status").classList.remove("success");

  try{
    const recipeIds=[...new Set(recipeDays.map(x=>x.recipe_id))];
    const {data:rows,error}=await db.from("recipe_ingredients_expanded")
      .select("*")
      .in("recipe_id",recipeIds)
      .order("sort_order");
    if(error)throw error;

    const merged=new Map();

    for(const day of recipeDays){
      const recipe=recipes.find(r=>r.id===day.recipe_id);
      const baseServings=Number(recipe?.base_servings||recipe?.serves||day.planned_servings||1);
      const plannedServings=Number(day.planned_servings||baseServings||1);
      const factor=baseServings>0?plannedServings/baseServings:1;

      for(const row of (rows||[]).filter(x=>x.recipe_id===day.recipe_id)){
        const destination=row.shopping_destination||"woolworths";
        const scaled=row.quantity===null?null:Number(row.quantity)*factor;
        const key=shoppingMergeKey(row);

        if(!merged.has(key)){
          merged.set(key,{
            ingredient_id:row.ingredient_id,
            item_name:row.ingredient_name||"Ingredient",
            quantity:scaled,
            display_quantity:row.display_quantity||null,
            unit:normaliseShoppingUnit(row.unit)||null,
            destination,
            notes:null
          });
        }else{
          const current=merged.get(key);
          if(current.quantity!==null&&scaled!==null){
            current.quantity=Number(current.quantity)+Number(scaled);
          }else if(current.display_quantity&&row.display_quantity&&current.display_quantity!==row.display_quantity){
            current.notes=[current.notes,row.display_quantity].filter(Boolean).join("; ");
          }
        }
      }
    }

    const {error:deleteError}=await db.from("shopping_items")
      .delete()
      .eq("source_type","meal_plan")
      .eq("meal_plan_id",plannerPlan.id);
    if(deleteError)throw deleteError;

    const payload=[...merged.values()].map((x,index)=>({
      shopping_list_id:getListId(x.destination)||getListId("woolworths"),
      ingredient_id:x.ingredient_id||null,
      item_name:x.item_name,
      quantity:x.quantity===null?null:roundScaledQuantity(x.quantity,x.unit,x.item_name),
      display_quantity:x.display_quantity,
      unit:x.unit,
      source_type:"meal_plan",
      meal_plan_id:plannerPlan.id,
      notes:x.notes,
      sort_order:index+1,
      is_checked:false
    }));

    if(payload.length){
      const {error:insertError}=await db.from("shopping_items").insert(payload);
      if(insertError)throw insertError;
    }

    const {error:planError}=await db.from("meal_plans")
      .update({shopping_generated_at:new Date().toISOString(),status:"planned"})
      .eq("id",plannerPlan.id);
    if(planError)throw planError;

    await loadPrivateData();
    await refreshSmartHome();
    $("shopping-generation-status").textContent=`Smart lists generated: ${payload.length} combined items.`;
    $("shopping-generation-status").classList.add("success");
  }catch(error){
    $("shopping-generation-status").textContent=error.message||String(error);
  }
}

async function resetGeneratedShopping(){
  if(!currentUser){showLogin();return}
  if(!plannerPlan){
    alert("Open a saved week first.");
    return;
  }
  if(!confirm("Clear the generated recipe items for this week? Manual items will remain."))return;

  const {error}=await db.from("shopping_items")
    .delete()
    .eq("source_type","meal_plan")
    .eq("meal_plan_id",plannerPlan.id);
  if(error){alert(error.message);return}

  await loadPrivateData();
  await refreshSmartHome();
  $("shopping-generation-status").textContent="Generated recipe items cleared. Manual items remain.";
  $("shopping-generation-status").classList.add("success");
}

$("generate-shopping-lists").onclick=generateShoppingLists;
$("planner-generate-shopping").onclick=async()=>{
  await plannerSaveWeek();
  if(plannerPlan)await generateShoppingLists();
};
$("reset-generated-lists").onclick=resetGeneratedShopping;

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


/* ===== Sprint 2: Weekly Planner Engine ===== */
const plannerPad=n=>String(n).padStart(2,"0");
const plannerIso=d=>`${d.getFullYear()}-${plannerPad(d.getMonth()+1)}-${plannerPad(d.getDate())}`;
const plannerParse=s=>{const [y,m,d]=s.split("-").map(Number);return new Date(y,m-1,d)};
const plannerAdd=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const plannerSaturday=d=>{const x=new Date(d.getFullYear(),d.getMonth(),d.getDate());x.setDate(x.getDate()-((x.getDay()+1)%7));return x};
const plannerDay=d=>d.toLocaleDateString("en-AU",{weekday:"long"});
const plannerShort=d=>d.toLocaleDateString("en-AU",{day:"numeric",month:"short"});
const plannerLong=d=>d.toLocaleDateString("en-AU",{weekday:"long",day:"numeric",month:"long",year:"numeric"});

function plannerSetWeek(date){
  plannerWeekStart=plannerSaturday(date);
  $("planner-week-start").value=plannerIso(plannerWeekStart);
  $("planner-week-range").textContent=`${plannerShort(plannerWeekStart)} – ${plannerShort(plannerAdd(plannerWeekStart,6))}`;
}
async function plannerOpenWeek(date=plannerWeekStart||new Date()){
  plannerSetWeek(date);plannerPlan=null;plannerDaysData=[];
  $("planner-status").textContent=currentUser?"Loading week…":"Sign in to save and load meal plans.";
  if(currentUser){
    const start=plannerIso(plannerWeekStart),end=plannerIso(plannerAdd(plannerWeekStart,6));
    const {data,error}=await db.from("meal_plans").select("*").eq("start_date",start).eq("end_date",end).limit(1);
    if(error){$("planner-status").textContent=error.message;return}
    plannerPlan=data?.[0]||null;
    if(plannerPlan){
      const {data:days,error:daysError}=await db.from("meal_plan_days").select("*").eq("meal_plan_id",plannerPlan.id).order("meal_date");
      if(daysError){$("planner-status").textContent=daysError.message;return}
      plannerDaysData=days||[];$("planner-status").textContent="Week planned ✓";
    }else $("planner-status").textContent="New week — choose your meals.";
  }
  plannerRenderDays();
  refreshSmartHome();
}
function plannerEntry(date){return plannerDaysData.find(x=>x.meal_date===plannerIso(date))||null}
function plannerLabel(e){
  if(!e)return {emoji:"＋",title:"Choose Meal",subtitle:"Tap to add"};
  if(e.meal_type==="recipe"){const r=recipes.find(x=>x.id===e.recipe_id);return {emoji:r?.emoji||"🍽️",title:r?.title||"Recipe",subtitle:`Serves ${e.planned_servings||r?.base_servings||r?.serves||"—"}`}}
  const map={leftovers:["🥡","Leftovers"],takeaway:["🍕","Takeaway"],eating_out:["🍽️","Eating Out"],free_night:["🌙","Free Night"],custom:["✏️",e.custom_meal_name||"Custom Meal"]};
  const [emoji,title]=map[e.meal_type]||["🍽️","Meal"];return {emoji,title,subtitle:e.notes||""};
}
function plannerRenderDays(){
  const today=plannerIso(new Date()),cards=[];
  for(let i=0;i<7;i++){const d=plannerAdd(plannerWeekStart,i),e=plannerEntry(d),m=plannerLabel(e);
    cards.push(`<article class="planner-day-card ${plannerIso(d)===today?"today":""}">
      <div class="planner-day-heading"><div><strong>${plannerDay(d)}</strong><span>${plannerShort(d)}</span></div>${plannerIso(d)===today?"<span>Today</span>":""}</div>
      <div class="planner-meal-content"><div class="planner-meal-emoji">${esc(m.emoji)}</div><h3>${esc(m.title)}</h3><p>${esc(m.subtitle)}</p></div>
      <div class="planner-day-actions"><button class="button secondary" data-plan-date="${plannerIso(d)}">${e?"Edit":"Choose Meal"}</button>${e?`<button class="button secondary" data-clear-date="${plannerIso(d)}">Clear</button>`:""}</div>
    </article>`)}
  $("planner-days").innerHTML=cards.join("");
  document.querySelectorAll("[data-plan-date]").forEach(b=>b.onclick=()=>plannerOpenPicker(b.dataset.planDate));
  document.querySelectorAll("[data-clear-date]").forEach(b=>b.onclick=()=>plannerClearDate(b.dataset.clearDate));
}
function plannerOpenPicker(date){
  if(!currentUser){showLogin();return}
  plannerEditingDate=date;const e=plannerDaysData.find(x=>x.meal_date===date);
  plannerSelectedType=e?.meal_type||"recipe";plannerSelectedRecipeId=e?.recipe_id||null;
  $("meal-picker-date-title").textContent=plannerLong(plannerParse(date));$("meal-picker-search-input").value="";
  plannerPickerCategory="All";plannerPickerMember="All";
  $("meal-picker-custom-name").value=e?.custom_meal_name||"";$("meal-picker-notes").value=e?.notes||"";
  const r=recipes.find(x=>x.id===plannerSelectedRecipeId);
  $("meal-picker-servings").value=e?.planned_servings||r?.base_servings||r?.serves||6;
  document.querySelectorAll(".meal-type-option").forEach(b=>b.classList.toggle("active",b.dataset.mealType===plannerSelectedType));
  plannerPanels();plannerRenderPickerFilters();plannerRenderRecipes();$("meal-picker-dialog").showModal();
}
function plannerPanels(){$("meal-picker-recipe-panel").hidden=plannerSelectedType!=="recipe";$("meal-picker-custom-panel").hidden=plannerSelectedType!=="custom"}
document.querySelectorAll(".meal-type-option").forEach(b=>b.onclick=()=>{plannerSelectedType=b.dataset.mealType;document.querySelectorAll(".meal-type-option").forEach(x=>x.classList.toggle("active",x===b));plannerPanels()});
function plannerRenderPickerFilters(){
  const categoryContainer=$("meal-picker-category-filters");
  const memberContainer=$("meal-picker-family-filters");
  if(!categoryContainer||!memberContainer)return;

  categoryContainer.innerHTML=[
    `<button class="picker-chip ${plannerPickerCategory==="All"?"active":""}" data-picker-category="All">All</button>`,
    ...categories.map(c=>`<button class="picker-chip ${plannerPickerCategory===c.name?"active":""}" data-picker-category="${esc(c.name)}">${esc(c.icon||"🍽️")} ${esc(c.name)}</button>`)
  ].join("");

  memberContainer.innerHTML=[
    `<button class="picker-chip ${plannerPickerMember==="All"?"active":""}" data-picker-member="All">Everyone</button>`,
    ...members.map(m=>`<button class="picker-chip ${plannerPickerMember===m.id?"active":""}" data-picker-member="${m.id}">${esc(m.avatar_emoji||"👤")} ${esc(m.display_name)}</button>`)
  ].join("");

  categoryContainer.querySelectorAll("[data-picker-category]").forEach(b=>b.onclick=()=>{
    plannerPickerCategory=b.dataset.pickerCategory;
    plannerRenderPickerFilters();
    plannerRenderRecipes();
  });
  memberContainer.querySelectorAll("[data-picker-member]").forEach(b=>b.onclick=()=>{
    plannerPickerMember=b.dataset.pickerMember;
    plannerRenderPickerFilters();
    plannerRenderRecipes();
  });
}

function plannerRenderRecipes(){
  const q=$("meal-picker-search-input").value.trim().toLowerCase();

  const favouriteRecipeIds=plannerPickerMember==="All"
    ? null
    : new Set(recipeFavourites
        .filter(f=>f.family_member_id===plannerPickerMember)
        .map(f=>f.recipe_id));

  const list=recipes.filter(r=>{
    const searchMatch=!q||[
      r.title,r.category,r.story,
      ...(Array.isArray(r.ingredients)?r.ingredients:[])
    ].join(" ").toLowerCase().includes(q);

    const categoryMatch=plannerPickerCategory==="All"||r.category===plannerPickerCategory;
    const memberMatch=plannerPickerMember==="All"||favouriteRecipeIds.has(r.id);
    return searchMatch&&categoryMatch&&memberMatch;
  });

  $("meal-picker-result-count").textContent=`${list.length} recipe${list.length===1?"":"s"}`;

  $("meal-picker-recipe-list").innerHTML=list.length
    ? list.map(r=>{
        const lovedBy=members
          .filter(m=>recipeFavourites.some(f=>f.recipe_id===r.id&&f.family_member_id===m.id))
          .map(m=>m.display_name);

        return `<button class="meal-picker-recipe ${plannerSelectedRecipeId===r.id?"active":""}" data-picker-recipe="${r.id}">
          <span class="emoji">${esc(r.emoji||"🍽️")}</span>
          <span class="picker-recipe-copy">
            <strong>${esc(r.title)}</strong>
            <span class="picker-recipe-meta">
              <small>${esc(r.category||"Recipe")}</small>
              <small>Serves ${esc(r.base_servings??r.serves??"—")}</small>
              ${lovedBy.length?`<small>❤️ ${esc(lovedBy.join(", "))}</small>`:""}
            </span>
          </span>
        </button>`;
      }).join("")
    : '<div class="meal-picker-empty">No recipes match those filters.</div>';

  document.querySelectorAll("[data-picker-recipe]").forEach(b=>b.onclick=()=>{
    plannerSelectedRecipeId=b.dataset.pickerRecipe;
    const r=recipes.find(x=>x.id===plannerSelectedRecipeId);
    if(r)$("meal-picker-servings").value=r.base_servings||r.serves||6;
    plannerRenderRecipes();
  });
}
$("meal-picker-search-input").oninput=plannerRenderRecipes;
$("meal-picker-clear-filters").onclick=()=>{
  $("meal-picker-search-input").value="";
  plannerPickerCategory="All";
  plannerPickerMember="All";
  plannerRenderPickerFilters();
  plannerRenderRecipes();
};
$("meal-servings-minus").onclick=()=>{$("meal-picker-servings").value=Math.max(1,Number($("meal-picker-servings").value||1)-1)};
$("meal-servings-plus").onclick=()=>{$("meal-picker-servings").value=Math.max(1,Number($("meal-picker-servings").value||1)+1)};
$("meal-picker-apply").onclick=()=>{
  if(plannerSelectedType==="recipe"&&!plannerSelectedRecipeId)return alert("Choose a recipe first.");
  if(plannerSelectedType==="custom"&&!$("meal-picker-custom-name").value.trim())return alert("Enter the custom meal name.");
  const e=plannerDaysData.find(x=>x.meal_date===plannerEditingDate);
  const value={...(e||{}),meal_date:plannerEditingDate,meal_type:plannerSelectedType,recipe_id:plannerSelectedType==="recipe"?plannerSelectedRecipeId:null,custom_meal_name:plannerSelectedType==="custom"?$("meal-picker-custom-name").value.trim():null,planned_servings:plannerSelectedType==="recipe"?Number($("meal-picker-servings").value||6):null,notes:$("meal-picker-notes").value.trim()||null};
  e?Object.assign(e,value):plannerDaysData.push(value);plannerRenderDays();$("planner-status").textContent="Changes ready to save.";$("meal-picker-dialog").close();
};
async function plannerClearDate(date){
  const e=plannerDaysData.find(x=>x.meal_date===date);
  if(e?.id&&currentUser){const {error}=await db.from("meal_plan_days").delete().eq("id",e.id);if(error)return alert(error.message)}
  plannerDaysData=plannerDaysData.filter(x=>x.meal_date!==date);plannerRenderDays();$("planner-status").textContent="Day cleared.";
}
$("meal-picker-clear").onclick=async()=>{await plannerClearDate(plannerEditingDate);$("meal-picker-dialog").close()};
async function plannerSaveWeek(){
  if(!currentUser){showLogin();return}
  $("planner-status").textContent="Saving week…";
  try{
    const start=plannerIso(plannerWeekStart),end=plannerIso(plannerAdd(plannerWeekStart,6));
    if(!plannerPlan){const {data,error}=await db.from("meal_plans").insert({title:`Week of ${plannerShort(plannerWeekStart)}`,start_date:start,end_date:end,preferred_start_day:"saturday",status:"planned"}).select().single();if(error)throw error;plannerPlan=data}
    else{const {error}=await db.from("meal_plans").update({status:"planned",preferred_start_day:"saturday"}).eq("id",plannerPlan.id);if(error)throw error}
    const {data:existing,error:readError}=await db.from("meal_plan_days").select("id,meal_date").eq("meal_plan_id",plannerPlan.id);if(readError)throw readError;
    const dates=new Set(plannerDaysData.map(x=>x.meal_date)),remove=(existing||[]).filter(x=>!dates.has(x.meal_date)).map(x=>x.id);
    if(remove.length){const {error}=await db.from("meal_plan_days").delete().in("id",remove);if(error)throw error}
    for(let i=0;i<plannerDaysData.length;i++){const x=plannerDaysData[i],payload={meal_plan_id:plannerPlan.id,meal_date:x.meal_date,meal_type:x.meal_type,recipe_id:x.recipe_id||null,custom_meal_name:x.custom_meal_name||null,planned_servings:x.planned_servings||null,notes:x.notes||null,sort_order:i+1};
      if(x.id){const {error}=await db.from("meal_plan_days").update(payload).eq("id",x.id);if(error)throw error}
      else{const {data,error}=await db.from("meal_plan_days").insert(payload).select().single();if(error)throw error;Object.assign(x,data)}
    }
    $("planner-status").textContent="Week planned ✓";$("planner-status").classList.add("success");await plannerOpenWeek(plannerWeekStart);
  }catch(e){$("planner-status").classList.remove("success");$("planner-status").textContent=e.message||String(e)}
}
$("planner-save-week").onclick=plannerSaveWeek;
$("planner-prev-week").onclick=()=>plannerOpenWeek(plannerAdd(plannerWeekStart,-7));
$("planner-next-week").onclick=()=>plannerOpenWeek(plannerAdd(plannerWeekStart,7));
$("planner-week-start").onchange=()=>plannerOpenWeek(plannerParse($("planner-week-start").value));

$("plan-week-button").onclick=()=>{setPage("planner");plannerOpenWeek(plannerWeekStart||new Date())};
$("choose-tonight-button").onclick=()=>{setPage("planner");plannerOpenWeek(plannerWeekStart||new Date())};
init();
