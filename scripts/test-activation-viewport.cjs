const { app, BrowserWindow } = require("electron");
const path = require("node:path");

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: 760,
    height: 690,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  await window.loadFile(path.join(__dirname, "..", "electron", "activation.html"));
  const layout = await window.webContents.executeJavaScript(`({
    viewport: { width: innerWidth, height: innerHeight },
    document: {
      clientHeight: document.documentElement.clientHeight,
      scrollHeight: document.documentElement.scrollHeight,
      overflow: getComputedStyle(document.documentElement).overflow
    },
    body: {
      clientHeight: document.body.clientHeight,
      scrollHeight: document.body.scrollHeight,
      overflow: getComputedStyle(document.body).overflow
    },
    textareaResize: getComputedStyle(document.querySelector("textarea")).resize,
    card: document.querySelector("main").getBoundingClientRect().toJSON()
  })`);

  console.log(JSON.stringify(layout, null, 2));
  await window.close();
  app.quit();
});
