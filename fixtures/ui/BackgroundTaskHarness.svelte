<script lang="ts">
  import { activeThemeStyle, appearanceSelection } from '$lib/ui-kit';
  import BackgroundTaskCard from '$lib/components/app/BackgroundTaskCard.svelte';
  import type { BackgroundTask } from '../../packages/presentation-workbench/background-tasks.js';
  import '../../src/app.css';
  let task = $state<BackgroundTask>({id:'shell-42',rootTurnId:'turn',name:'运行评估',command:'python eval.py --input <script>alert(1)</scr'+'ipt>',status:'running',activity:'已完成 4 / 10 项',outputPath:'/tmp/eval.output'});
  Object.assign(window,{finishBackgroundTask:()=>{task={...task,status:'failed',exitCode:2,activity:'评估结束：2 项未通过'};}});
</script>
<div class="app-shell" data-ui-kit={$appearanceSelection.kitId} style={$activeThemeStyle}>
  <main style="padding:16px; width:min(700px,100%); min-width:0;">
    <BackgroundTaskCard {task}/>
  </main>
</div>
