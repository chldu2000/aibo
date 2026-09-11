import { mount, createRawSnippet } from 'svelte';
import Workbench from '/src/lib/workbench/WorkbenchPresentation.svelte';
    window.recoveryWorkbench = mount(Workbench, {
      target: document.getElementById('probe'),
      props: { windowId: 'recovery-probe', snapshot: { workspaceId: 'w', sessionId: 's', draft: 'keep', navigation: null, timelineRevision: 1 },
        children: createRawSnippet(() => ({ render: () => '<textarea aria-label="draft">keep</textarea>' })) },
    });
