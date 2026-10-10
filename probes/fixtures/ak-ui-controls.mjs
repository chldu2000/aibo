import {mount} from 'svelte';
import {language} from '../../src/lib/i18n/runtime';
import App from './ak-ui-controls.svelte';
// The app composition initializes the language before mounting; the fixture labels are Chinese.
language.set({preference:'zh-CN',locale:'zh-CN'});
mount(App,{target:document.getElementById('app')});
