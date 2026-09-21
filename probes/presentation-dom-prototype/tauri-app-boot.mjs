
import('./tauri-app-client.mjs').catch(error => fetch('/__p0_app_report', {method:'POST',body:JSON.stringify({completed:false,error:String(error),checks:[],phase:'module import'})}));
