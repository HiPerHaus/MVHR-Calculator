import {serializeProject,deserializeProject} from '../domain/spatial.mjs';
export const CLOUD_BUCKET='studio-drawings';
export const CLOUD_FILE_FORMAT='hiper-studio-cloud-drawing-v1';
const MAX_CLOUD_BYTES=48*1024*1024;
export class CloudConflictError extends Error {constructor(){super('This cloud drawing has changed in another tab. Open the latest cloud copy, or use Save As to keep your changes separately.');this.name='CloudConflictError';}}
const checked=result=>{if(result.error)throw new Error(result.error.message??'Cloud request failed');return result.data;};
export function createCloudProjectStore(client,{uuid=()=>crypto.randomUUID()}={}) {
 return {
  async workspaces(){return checked(await client.from('studio_workspaces').select('id,name').order('name'));},
  async list(workspaceId){return checked(await client.from('studio_projects').select('*').eq('workspace_id',workspaceId).order('updated_at',{ascending:false}));},
  async save({project,name,workspaceId,userId,record=null}) {
   const cleanName=name.trim();if(!cleanName||cleanName.length>120)throw new TypeError('Project name must contain 1–120 characters');
   if(record && (record.workspace_id!==workspaceId || record.project_id!==project.id))throw new TypeError('Cloud project identity mismatch');
   const id=record?.id??uuid(),path=`${workspaceId}/${userId}/${id}/${uuid()}.json`;
   const projectJson=serializeProject(project);
   const file=new Blob([JSON.stringify({format:CLOUD_FILE_FORMAT,projectId:project.id,projectJson})],{type:'application/json'});
   if(file.size>MAX_CLOUD_BYTES)throw new RangeError('This drawing exceeds the 48 MB cloud file limit. Export a backup and reduce the reference file size.');
   const bucket=client.storage.from(CLOUD_BUCKET);
   checked(await bucket.upload(path,file,{contentType:'application/json',upsert:false}));
   const payload={id,workspace_id:workspaceId,project_id:project.id,name:cleanName,object_path:path,updated_by:userId};
   let saved;
   try {
    const request=record ? client.from('studio_projects').update(payload).eq('id',id).eq('workspace_id',workspaceId).eq('save_version',record.save_version) : client.from('studio_projects').insert(payload);
    const result=await request.select('*').maybeSingle();
    if(result.error)throw new Error(result.error.message);
    if(!result.data)throw new CloudConflictError();
    saved=result.data;
   }catch(error){
    // Never remove a file after an ambiguous network result: the commit may have succeeded.
    // A confirmed version conflict has no new record pointing to this upload.
    if(error instanceof CloudConflictError)await bucket.remove([path]).catch(()=>{});
    throw error;
   }
   return {record:saved,projectJson};
  },
  async open(record){
   const blob=checked(await client.storage.from(CLOUD_BUCKET).download(record.object_path));
   if(blob.size>MAX_CLOUD_BYTES)throw new RangeError('Cloud drawing exceeds the supported file size');
   const file=JSON.parse(await blob.text());
   if(file.format!==CLOUD_FILE_FORMAT || file.projectId!==record.project_id)throw new TypeError('Invalid cloud drawing file');
   const project=deserializeProject(file.projectJson);
   if(project.id!==record.project_id)throw new TypeError('Cloud drawing identity mismatch');
   return {project,name:record.name,record};
  }
 };
}
