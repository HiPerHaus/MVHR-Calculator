export const COMPANY_FIELDS={companyName:160,address:500,email:160,phone:60,website:200,contactName:160,contactEmail:160,contactPhone:60};
export function normalizeCompanyProfile(value={}){
 const result={};for(const [field,limit] of Object.entries(COMPANY_FIELDS)){
  const text=value[field]??'';if(typeof text!=='string'||text.length>limit||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text))throw new TypeError(`Invalid company ${field}`);result[field]=text.trim();
 }return result;
}
export function validateLogoDataUrl(value){
 if(!value)return '';
 if(typeof value!=='string'||value.length>2800000||!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))throw new TypeError('Use a PNG or JPEG logo up to 2 MB');
 const payload=atob(value.split(',')[1]);
 if(value.startsWith('data:image/png')&&!payload.startsWith('\x89PNG\r\n\x1a\n'))throw new TypeError('Invalid PNG logo');
 if(value.startsWith('data:image/jpeg')&&!(payload.charCodeAt(0)===255&&payload.charCodeAt(1)===216))throw new TypeError('Invalid JPEG logo');
 return value;
}
export function createCompanyProfileStore(client,{uuid=()=>crypto.randomUUID()}={}){
 const checked=r=>{if(r.error)throw new Error(r.error.message);return r.data;};
 return {
  async load(workspaceId,userId){
   const row=checked(await client.from('studio_company_profiles').select('*').eq('workspace_id',workspaceId).maybeSingle());
   const member=checked(await client.from('studio_memberships').select('role').eq('workspace_id',workspaceId).eq('user_id',userId).single());
   let logoDataUrl='';if(row?.logo_path){const blob=checked(await client.storage.from('studio-drawings').download(row.logo_path));if(blob.size>2800100)throw new Error('Stored logo is too large');logoDataUrl=validateLogoDataUrl(JSON.parse(await blob.text()).dataUrl);}
   return {row,details:normalizeCompanyProfile(row?.details),logoDataUrl,editable:member.role==='owner'};
  },
  async save({workspaceId,userId,details,logoDataUrl,previous}){
   const clean=normalizeCompanyProfile(details),logo=validateLogoDataUrl(logoDataUrl);let path=previous?.row?.logo_path??null;
   if(logo!==previous?.logoDataUrl){
    path=null;if(logo){path=`${workspaceId}/${userId}/branding/${uuid()}.json`;checked(await client.storage.from('studio-drawings').upload(path,new Blob([JSON.stringify({dataUrl:logo})],{type:'application/json'}),{contentType:'application/json',upsert:false}));}
   }
   const payload={workspace_id:workspaceId,details:clean,logo_path:path};
   const query=previous?.row?client.from('studio_company_profiles').update(payload).eq('workspace_id',workspaceId).eq('version',previous.row.version):client.from('studio_company_profiles').insert(payload);
   const row=checked(await query.select('*').maybeSingle());if(!row)throw new Error('Company details changed in another tab. Reopen Account before saving.');
   return {row,details:clean,logoDataUrl:logo,editable:true};
  }
 };
}
