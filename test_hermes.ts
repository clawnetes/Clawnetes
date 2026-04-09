async function checkHermes() {
  try {
    const res = await fetch("http://127.0.0.1:9999/health");
    console.log("Status:", res.status);
  } catch (e) {
    console.log("Failed:", e);
  }
}
checkHermes();
