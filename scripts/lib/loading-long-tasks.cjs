'use strict';
// Browser-side diagnostics. Install only in an explicitly profiled run.
function installLongTaskDiagnostics(){
 window.__MM_LOADING_LONG_TASKS__=[];
 window.__MM_LOADING_LONG_TASK_SUPPORTED__=typeof PerformanceObserver==='function'&&PerformanceObserver.supportedEntryTypes?.includes('longtask');
 if(window.__MM_LOADING_LONG_TASK_SUPPORTED__)new PerformanceObserver(list=>{
  for(const entry of list.getEntries())if(window.__MM_LOADING_LONG_TASKS__.length<500)window.__MM_LOADING_LONG_TASKS__.push({startTime:entry.startTime,duration:entry.duration});
 }).observe({type:'longtask',buffered:true});
}
module.exports={installLongTaskDiagnostics};
