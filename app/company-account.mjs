import {COMPANY_FIELDS,normalizeCompanyProfile,validateLogoDataUrl,createCompanyProfileStore} from '../src/persistence/company-profile.mjs';
export function initializeCompanyAccount(client,state,onChange){
 const store=createCompanyProfileStore(client),form=document.querySelector('#company-form'),fieldset=document.querySelector('#company-fields'),status=document.querySelector('#company-status'),preview=document.querySelector('#company-logo-preview');
 let pendingLogo='';
 function render(){
  const profile=state.companyProfile;document.querySelector('#account-email').textContent=state.user?.email??'Not signed in';
  document.querySelector('#account-workspace-name').textContent=state.workspace?.name??'Sign in to manage company details';
  fieldset.disabled=!profile?.editable;document.querySelector('#account-page-signin').hidden=Boolean(state.user);
  document.querySelector('#account-page-signout').hidden=!state.user;
  for(const key of Object.keys(COMPANY_FIELDS))form.elements.namedItem(key).value=profile?.details?.[key]??'';
  pendingLogo=profile?.logoDataUrl??'';preview.hidden=!pendingLogo;if(pendingLogo)preview.src=pendingLogo;else preview.removeAttribute('src');
  status.textContent=state.profileError || (!state.user?'Sign in with an invited account to manage company details.':profile?(profile.editable?'Company details and logo are used on your drawing sheets.':'Company details can be edited by the workspace owner.'):'Loading company details…');
 }
 async function load(){
  state.companyProfile=null;state.profileError='';render();if(!state.workspace||!state.user)return;
  const workspaceId=state.workspace.id,userId=state.user.id;
  try{const result=await store.load(workspaceId,userId);if(state.workspace?.id!==workspaceId||state.user?.id!==userId)return;state.companyProfile=result;}
  catch(error){if(state.workspace?.id!==workspaceId||state.user?.id!==userId)return;state.profileError=error.message;}
  render();onChange(state);
 }
 document.querySelector('#company-logo').addEventListener('change',async event=>{
  status.textContent='';try{const file=event.target.files?.[0];if(!file)return;if(file.size>2*1024*1024)throw new Error('Use a PNG or JPEG logo up to 2 MB.');const dataUrl=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(file);});pendingLogo=validateLogoDataUrl(dataUrl);const image=new Image();image.src=pendingLogo;await image.decode();if(image.width>4096||image.height>4096)throw new Error('Logo dimensions must be 4096 pixels or smaller.');preview.src=pendingLogo;preview.hidden=false;status.textContent='Logo ready. Choose Save company details to apply it.';}catch(error){pendingLogo=state.companyProfile?.logoDataUrl??'';status.textContent=error.message;}finally{event.target.value='';}
 });
 document.querySelector('#remove-company-logo').addEventListener('click',()=>{pendingLogo='';preview.hidden=true;preview.removeAttribute('src');status.textContent='Choose Save company details to remove the logo from future sheets.';});
 form.addEventListener('submit',async event=>{
  event.preventDefault();if(!state.companyProfile?.editable)return;
  const workspaceId=state.workspace.id,userId=state.user.id;
  const formValues=Object.fromEntries(new FormData(form));
  fieldset.disabled=true;status.textContent='Saving company details…';
  try{const details=normalizeCompanyProfile(formValues);const saved=await store.save({workspaceId,userId,details,logoDataUrl:pendingLogo,previous:state.companyProfile});if(state.workspace?.id!==workspaceId||state.user?.id!==userId)return;state.companyProfile=saved;render();status.textContent='Company details saved. New sheet previews will use these details.';onChange(state);}catch(error){status.textContent=error.message;}finally{fieldset.disabled=!state.companyProfile?.editable;}
 });
 return {load,render};
}
