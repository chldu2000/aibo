<script>
  import '../../src/app.css';
  import { GoalBar, SubagentCard, SubagentDialog, ModelMatrix, ModelContextSelect, SettingsSection, Button, Badge, Input, Textarea } from '../../src/lib/ui-kit';
  import akThemes from '../../src/lib/ui-kit/kits/ak-ui/themes.json';
  import materialThemes from '../../src/lib/ui-kit/kits/material3/themes.json';
  import { setUiKit } from '../../src/lib/ui-kit/registry';
  const kit = new URLSearchParams(location.search).get('kit') === 'material3' ? 'material3' : 'ak-ui';
  const themes = kit === 'material3' ? materialThemes : akThemes;
  setUiKit(kit);
  let theme = $state('light');
  let busy = $state(false);
  let open = $state(false);
  let current = $state('normal');
  let selected = $state('');
  let selectedModel = $state('third-party/model');
  const expandedMatrix = new URLSearchParams(location.search).has('matrix');
  let tier = $state(false);
  let result = $state('');
  let checked = $state(false);
  let switched = $state(false);
  let choice = $state('first');
  const style = $derived(Object.entries(themes.themes.find(t => t.id === theme).tokens).map(([k,v]) => `${k}:${v}`).join(';'));
  const columns = expandedMatrix
    ? ['low','medium','high','xhigh','max','ultra'].map(id=>({id,label:id})).map(c=>({...c,description:null}))
    : [{id:'high',label:'高',description:null},{id:'max',label:'最高',description:null}];
  const models = [{reference:'third-party/model',label:'第三方模型'}, ...(expandedMatrix ? [{reference:'reasoning/model',label:'推理模型 Long Context'},{reference:'fast/model',label:'轻量模型'}, ...Array.from({length:5},(_,index)=>({reference:`extra/${index}`,label:`其他模型 ${index+1}`}))] : [])];
  const rows = $derived(models.map((model,index)=>({...model,isDefault:index===0,active:selectedModel===model.reference,defaultActive:selectedModel===model.reference&&!selected,cells:columns.map(c=>({...c,available:index===1||c.id!=='max',active:selectedModel===model.reference&&c.id===selected}))})));
</script>
<div class="app-shell" data-ui-kit={kit} data-ui-theme={theme} {style}>
  <main class="fixture">
    <div><Button onclick={()=>theme=theme==='light'?'dark':'light'}>切换主题</Button><Button onclick={()=>busy=!busy}>切换忙碌</Button></div>
    <GoalBar objective={'检查长目标的换行和布局。'.repeat(12)} statusLabel="运行中" usageLabel="12 / 100" {busy} onPause={()=>result='pause'} onResume={()=>result='resume'} onClear={()=>result='clear'}/>
    <SubagentCard name="第三方子 Agent" task="检查迁移后的组件是否保留可访问操作和清晰层级" statusLabel="等待中" activity="等待活动记录" failed={false} onOpen={()=>open=true}/>
    <SubagentDialog {open} title="子 Agent 过程" task="检查组件" statusLabel="等待中" onClose={()=>open=false}><p>保留子 Agent 的详细过程。</p></SubagentDialog>
    <ModelContextSelect options={[{id:'normal',label:'标准',description:null},{id:'large',label:'扩展',description:null}]} {current} disabled={busy} onSelect={id=>{current=id;result=id}}/>
    <div class:matrix-preview={expandedMatrix}><ModelMatrix {columns} {rows} defaultLabel="默认" defaultTitle="默认强度" fastTier={{id:'fast',label:'快速',active:tier}} disabled={busy} onSelect={(model,id)=>{selectedModel=model;selected=id??'';result=id??'default'}} onSelectServiceTier={id=>{tier=id==='fast';result=id}}/></div>
    <SettingsSection title="工作台布局" description="同一套语义接口和动作" items={[{id:'layout',title:'标准布局',description:'保留导航和辅助信息',icon:'panel-right',actions:[{id:'apply',label:'应用',intent:'install'}]}]} onAction={(id,action)=>result=`${id}:${action}`}/>
    <section class="form-fixture" aria-label="ak-ui 表单状态">
      <label>普通输入<Input aria-label="普通输入" placeholder="输入名称" /></label>
      <label>校验错误<Input aria-label="校验错误" aria-invalid="true" aria-describedby="validation-message" /><small id="validation-message" role="alert">请输入名称</small></label>
      <label>不可编辑<Input aria-label="不可编辑" disabled value="已锁定" /></label>
      <label>多行输入<Textarea aria-label="多行输入" placeholder="输入说明" /></label>
      <label>原生选择<select aria-label="原生选择"><option value="first">第一个选项</option><option value="second">第二个选项</option></select></label>
      <label class="choice"><input type="checkbox" bind:checked />复选选择</label>
      <label class="choice"><input type="checkbox" role="switch" aria-label="开关选择" bind:checked={switched} />开关选择</label>
      <div role="radiogroup" aria-label="单选选择">
        <label class="choice"><input type="radio" name="choice" value="first" bind:group={choice} />第一个</label>
        <label class="choice"><input type="radio" name="choice" value="second" bind:group={choice} />第二个</label>
      </div>
    </section>
    <section class="variant-fixture" aria-label="按钮与状态标签">
      {#each ['default', 'secondary', 'outline', 'ghost', 'destructive', 'send', 'queue', 'abort'] as variant}
        <Button {variant} aria-label={`按钮 ${variant}`} onclick={() => result = variant}>{variant}</Button>
      {/each}
      {#each ['default', 'secondary', 'outline', 'success', 'warning', 'destructive'] as variant}
        <Badge {variant} aria-label={`标签 ${variant}`}>{variant}</Badge>
      {/each}
    </section>
    <output aria-label="操作结果">{result}</output>
  </main>
</div>
<style>
  .fixture { display: grid; grid-auto-rows: max-content; align-content: start; gap: 16px; overflow: auto; padding: 16px; width: 100%; max-width: 900px; margin-inline: auto; }
  .matrix-preview { width: min(500px, 100%); min-width: 0; }
  .matrix-preview :global(.ui-model-matrix-wrap) { scrollbar-gutter: stable; }
  .form-fixture { display: grid; gap: 16px; }
  .form-fixture label:not(.choice) { display: grid; gap: 8px; }
  .choice { display: flex; align-items: center; gap: 12px; min-height: 44px; }
</style>
