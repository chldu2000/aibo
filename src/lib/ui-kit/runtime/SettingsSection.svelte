<script lang="ts">
  import { activeUiKit } from '../registry';
  import type { UiSettingsSectionProps } from '../contract';
  let props: UiSettingsSectionProps = $props();
  const Component = $derived($activeUiKit.SettingsSection);
</script>
<Component {...props} />
