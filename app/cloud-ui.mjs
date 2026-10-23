import {createClient} from './vendor/supabase.mjs';
import {cloudConfig} from './cloud-config.mjs';
import {createAuthStorage} from '../src/persistence/auth-storage.mjs';
import {createCloudProjectStore} from '../src/persistence/cloud-project-store.mjs';

export function initializeCloudUI({onChange,onOpen,beforeSignOut,onSignedOut}) {
 const client=createClient(cloudConfig.url,cloudConfig.publishableKey,{auth:{storage:createAuthStorage(window.indexedDB),storageKey:'hiper-studio-auth-v1',persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 const store=createCloudProjectStore(client);
 const state={user:null,workspace:null,workspaces:[],store,loading:true};
 const account=document.querySelector('#account-button'),dialog=document.querySelector('#signin-dialog'),form=document.querySelector('#signin-form'),error=document.querySelector('#signin-error'),email=document.querySelector('#signin-email'),password=document.querySelector('#signin-password'),signedIn=document.querySelector('#signed-in-account'),out=document.querySelector('#signout-button');
 const projects=document.querySelector('#cloud-projects-dialog'),list=document.querySelector('#cloud-projects-list'),listStatus=document.querySelector('#cloud-projects-status');
 const text=(tag,value)=>{const element=document.createElement(tag);element.textContent=value;return element;};
 const notify=()=>{account.textContent=state.user?'Account':'Sign in';form.hidden=Boolean(state.user);signedIn.hidden=!state.user;out.hidden=!state.user;signedIn.textContent=state.user?`${state.user.email} · ${state.workspace?.name??'No invited workspace'}`:'';document.querySelector('#cloud-projects-button').disabled=!state.workspace;onChange(state);};
 let revision=0;
 async function refresh(session){
  const current=++revision;state.loading=true;state.user=session?.user??null;state.workspace=null;state.workspaces=[];notify();
  if(state.user)try{const workspaces=await store.workspaces();if(current!==revision)return;state.workspaces=workspaces;state.workspace=workspaces[0]??null;if(!state.workspace)error.textContent='This account has not been invited to a Studio workspace.';}catch(e){if(current===revision)error.textContent=e.message;}
  if(current!==revision)return;state.loading=false;notify();
 }
 account.addEventListener('click',()=>{error.textContent='';dialog.showModal();if(!state.user)email.focus();});
 document.querySelector('#close-signin').addEventListener('click',()=>{password.value='';dialog.close();});
 form.addEventListener('submit',async event=>{
  event.preventDefault();error.textContent='Signing in…';const submit=form.querySelector('[type="submit"]');submit.disabled=true;
  try{const result=await client.auth.signInWithPassword({email:email.value.trim(),password:password.value});if(result.error)throw result.error;password.value='';await refresh(result.data.session);if(state.workspace)dialog.close();else error.textContent='This account has not been invited to a Studio workspace.';}catch(e){error.textContent=e.message;}finally{submit.disabled=false;}
 });
 out.addEventListener('click',async()=>{error.textContent='';try{await beforeSignOut();const result=await client.auth.signOut({scope:'local'});if(result.error)throw result.error;await refresh(null);onSignedOut();dialog.close();}catch(e){error.textContent=e.message;}});
 document.querySelector('#close-cloud-projects').addEventListener('click',()=>projects.close());
 document.querySelector('#cloud-projects-button').addEventListener('click',async()=>{
  if(!state.workspace)return;projects.showModal();list.replaceChildren();listStatus.textContent='Loading cloud projects…';const userId=state.user.id;
  try{const records=await store.list(state.workspace.id);if(state.user?.id!==userId)return;listStatus.textContent=records.length?'Choose a drawing to open.':'No cloud drawings yet. Open your exported drawing, then choose Save to cloud.';
   for(const record of records){const row=text('div','');row.className='cloud-project-row';const copy=text('div','');copy.append(text('strong',record.name),text('small',`Saved ${new Date(record.updated_at).toLocaleString()} · version ${record.save_version}`));const open=text('button','Open');open.type='button';open.addEventListener('click',async()=>{open.disabled=true;listStatus.textContent='Opening cloud drawing…';try{const loaded=await store.open(record);if(state.user?.id!==userId)throw new Error('Account changed; cloud drawing was not opened');projects.close();onOpen(loaded);}catch(e){listStatus.textContent=e.message;}finally{open.disabled=false;}});row.append(copy,open);list.append(row);}
  }catch(e){listStatus.textContent=e.message;}
 });
 client.auth.onAuthStateChange((event,session)=>{if(event==='TOKEN_REFRESHED')return;setTimeout(()=>refresh(session),0);});
 client.auth.getSession().then(({data,error:sessionError})=>{if(sessionError)error.textContent=sessionError.message;return refresh(data.session);}).catch(e=>{state.loading=false;error.textContent=e.message;notify();});
 return state;
}
