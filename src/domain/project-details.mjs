export function createProjectDetails(){return {name:'',address:'',clientName:'',projectReference:'',drawingTitle:'',drawnBy:'',checkedBy:''};}
export function normalizeProjectDetails(value){
 if(!value || typeof value!=='object' || Array.isArray(value))throw new TypeError('Project details are required');
 const result={};
 for(const [key,limit] of Object.entries({name:120,address:500,clientName:160,projectReference:80,drawingTitle:160,drawnBy:120,checkedBy:120})){
  const text=value[key]??'';if(typeof text!=='string' || text.length>limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(text))throw new TypeError(`Invalid project ${key}`);result[key]=text.trim();
 }
 return result;
}
