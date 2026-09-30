/* Logic for your new tool. Shared helpers are available on window.NSZ:
     NSZ.toast(message, "error"?)      – small notification
     NSZ.downloadBlob(blob, filename)  – save a file to the user's computer
     NSZ.formatBytes(bytes)            – "1.2 MB"
*/
const { toast } = window.NSZ;

document.getElementById("demo-btn").addEventListener("click", () => {
  toast("It works! Now build your tool here.");
});

// Tell the page the tool started (otherwise it shows a "browser too old" notice).
window.NSZ.ready();
