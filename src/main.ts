import { mount, tick } from 'svelte';
import App from './App.svelte';
import './app.css';

const app = mount(App, {
  target: document.getElementById('app')!,
});

void tick().then(() => document.getElementById('boot-status')?.remove());

export default app;
