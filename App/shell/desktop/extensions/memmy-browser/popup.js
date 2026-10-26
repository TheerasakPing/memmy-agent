const thai = (chrome.i18n?.getUILanguage?.() || navigator.language).toLowerCase().startsWith("th");
const copy = (zh, th) => thai ? th : zh;
const status = document.getElementById("status");
const refresh = document.getElementById("refresh");
document.documentElement.lang = thai ? "th" : "zh-CN";
status.textContent = copy("正在连接 Memmy…", "กำลังเชื่อมต่อ Memmy…");
refresh.textContent = copy("重新检查", "ตรวจสอบอีกครั้ง");

async function showStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ action: "status" });
    if (!response?.connected) { status.textContent = copy("尚未连接到 Memmy。请先打开 Memmy。", "ยังไม่ได้เชื่อมต่อ Memmy กรุณาเปิดแอป Memmy"); return; }
    const paused = response.pausedTabCount || 0;
    refresh.textContent = paused ? copy("重新连接", "เชื่อมต่อใหม่") : copy("重新检查", "ตรวจสอบอีกครั้ง");
    if (paused) {
      status.textContent = thai ? `Memmy หยุดควบคุม ${paused} แท็บ เพราะปิดแถบดีบักของเบราว์เซอร์ คลิก “เชื่อมต่อใหม่” เพื่อกลับมาทำงาน` : `你关闭了浏览器顶部的调试提示，Memmy 已停止操作 ${paused} 个网页。点击“重新连接”即可恢复。`;
      return;
    }
    const count = response.controllableTabCount || 0;
    if (count) {
      status.textContent = thai ? `เชื่อมต่อ Memmy แล้ว ควบคุมได้ ${count} แท็บ ขณะทำงานอาจมีแถบดีบักแสดงชั่วคราว` : `已连接到 Memmy，${count} 个网页可以操作。Memmy 执行任务时浏览器顶部会显示调试提示，任务结束后自动消失。`;
      return;
    }
    const issue = response.tabStatuses?.find(tab => tab.status === "protected") || response.tabStatuses?.[0];
    status.textContent = `${thai ? "เชื่อมต่อ Memmy แล้ว แต่ยังไม่มีแท็บที่ควบคุมได้" : "已连接到 Memmy，当前没有可操作网页。"}${issue?.reason || copy("请打开普通网页后重新检查。", "กรุณาเปิดหน้าเว็บไซต์ทั่วไปแล้วตรวจสอบอีกครั้ง")}`;
  } catch { status.textContent = copy("尚未连接到 Memmy。请先打开 Memmy。", "ยังไม่ได้เชื่อมต่อ Memmy กรุณาเปิดแอป Memmy"); }
}

refresh.addEventListener("click", async () => {
  refresh.disabled = true; status.textContent = copy("正在检查浏览器页面…", "กำลังตรวจสอบหน้าเว็บ…");
  try {
    const response = await chrome.runtime.sendMessage({ action: "refresh" });
    if (response?.ok) await showStatus();
    else status.textContent = response?.error || copy("无法重新连接，请确认 Memmy 已打开。", "เชื่อมต่อใหม่ไม่สำเร็จ กรุณาตรวจว่า Memmy เปิดอยู่");
  } catch { status.textContent = copy("无法重新连接，请确认 Memmy 已打开。", "เชื่อมต่อใหม่ไม่สำเร็จ กรุณาตรวจว่า Memmy เปิดอยู่"); }
  finally { refresh.disabled = false; }
});
void showStatus();
