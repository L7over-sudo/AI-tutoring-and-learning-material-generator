import { createApp } from "vue";
import { createPinia } from "pinia";
import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import App from "./App.vue";
import "./styles/theme.css";
import "./styles/global.css";

createApp(App).use(createPinia()).use(ElementPlus).mount("#app");
