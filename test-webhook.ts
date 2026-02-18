// test-webhook.ts
// ⚠️ เอา URL จากหน้าเว็บ Webhook.site ของคุณมาใส่ตรงนี้ (เช็คให้ตรงเป๊ะๆ)
const URL = "https://webhook.site/f4303190-5549-41e1-8222-548094644681"; 

async function test() {
  console.log(`🚀 กำลังทดสอบยิงไปที่: ${URL}`);
  
  try {
    const response = await fetch(URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "Hello from Voc-BullQ",
        time: new Date().toISOString()
      })
    });

    if (response.ok) {
      console.log("✅ ยิงสำเร็จ! Status:", response.status);
      console.log("👉 รีบกลับไปดูที่หน้าเว็บ Webhook.site ว่ามีข้อมูลขึ้นไหม?");
    } else {
      console.error("❌ ยิงไม่เข้า! Status:", response.status, response.statusText);
    }
  } catch (error) {
    console.error("🔥 พัง! เชื่อมต่อไม่ได้:", error);
  }
}

test();