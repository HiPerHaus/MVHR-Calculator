// Auth sessions use IndexedDB so a full drawing localStorage journal cannot block sign-in.
export function createAuthStorage(indexedDB) {
 const memory=new Map();let database;
 const open=()=>database??=new Promise((resolve,reject)=>{
  if(!indexedDB)return reject(new Error('IndexedDB unavailable'));
  const request=indexedDB.open('hiper-studio-session-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('session');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
 async function access(mode,key,value){
  try {const db=await open();return await new Promise((resolve,reject)=>{
   const transaction=db.transaction('session',mode),store=transaction.objectStore('session');
   const request=mode==='readonly'?store.get(key):value===null?store.delete(key):store.put(value,key);
   transaction.oncomplete=()=>resolve(request.result??null);transaction.onerror=()=>reject(transaction.error);transaction.onabort=()=>reject(transaction.error);
  });}catch{return memory.get(key)??null;}
 }
 return {
  async getItem(key){return access('readonly',key);},
  async setItem(key,value){memory.set(key,value);await access('readwrite',key,value);},
  async removeItem(key){memory.delete(key);await access('readwrite',key,null);}
 };
}
