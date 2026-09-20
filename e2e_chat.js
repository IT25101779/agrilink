// GROUP CHAT — full-stack tests over real HTTP on the freshly seeded demo database.
const assert = require("assert"); const mongoose = require("mongoose");
const BASE = "http://127.0.0.1:5055/api"; let passed = 0; const ok = (m) => console.log(`  ok ${++passed}. ${m}`);
const { autoToken } = require("./test_identity");
async function http(method, path, { token, body, raw } = {}) {
  token = token || autoToken(path, body);
  const res = await fetch(BASE + path, { method, headers: { ...(token ? { Authorization: "Bearer " + token } : {}), ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (raw) return res; const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch (_) {} return { status: res.status, body: json, text };
}
const login = async (email, password = "Demo@1234") => { const r = await http("POST", "/auth/login", { body: { email, password } }); assert.equal(r.status, 200, email + " " + r.text); return { token: r.body.data.token, id: r.body.data.user.id, name: r.body.data.user.fullName }; };
const G = "/group-chat";
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const JPEG = b64([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const M4A = b64([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]);
(async () => {
  const User = require("./models/User"); await mongoose.connect("mongodb://127.0.0.1:27017/agrilink_e2e");
  // (test hygiene) drop chat rows left behind by users deleted in earlier runs
  const liveIds = (await User.find({}).select("_id").lean()).map((u) => u._id);
  for (const [name, field] of [["GroupMembership", "user"], ["GroupMessage", "sender"], ["ChatMedia", "uploader"], ["ChatReport", "reporter"]]) await require("./models/" + name).deleteMany({ [field]: { $nin: liveIds, $exists: true } });
  await User.deleteMany({ email: "admin.chat@agrilink.lk" }); await User.create({ fullName: "Admin Chat", email: "admin.chat@agrilink.lk", phone: "+94770000009", passwordHash: await User.hashPassword("Admin@1234"), role: "admin" });
  const A = await login("neighbour1@neighbour.demo.agrilink.lk"), B = await login("neighbour2@neighbour.demo.agrilink.lk"), C = await login("neighbour3@neighbour.demo.agrilink.lk"), D = await login("neighbour4@neighbour.demo.agrilink.lk"), R = await login("neighbour6@neighbour.demo.agrilink.lk");
  const BUYER = await login("demo.buyer@agrilink.lk"), ADMIN = await login("admin.chat@agrilink.lk", "Admin@1234"); ok("logged in as 5 farmers, a buyer and an admin");

  // ---------- access rules ----------
  assert.equal((await http("GET", G + "/groups")).status, 401); assert.equal((await http("GET", G + "/groups", { token: BUYER.token })).status, 403); assert.equal((await http("GET", "/admin/chat/reports", { token: A.token })).status, 403); ok("chat needs login; buyers are refused; farmers can't open the admin moderation API");

  // ---------- discovery ----------
  let r = await http("GET", G + "/groups/suggested", { token: A.token }); const sug = r.body.data.map((g) => g.key);
  assert.ok(sug.includes("all") && sug.includes("district:Kandy") && sug.includes("crop:Tomato") && sug.includes("cropdist:Tomato|Kandy") && sug.includes("cropdist:Beans (Bush)|Kandy")); assert.equal(r.body.district, "Kandy"); ok("suggestions follow the farmer: All Sri Lanka, Kandy, Tomato, Tomato+Kandy, Beans+Kandy…");
  r = await http("GET", G + "/groups/search?district=Kandy&crop=tomato", { token: A.token }); assert.deepEqual(r.body.data.map((g) => g.key), ["cropdist:Tomato|Kandy", "crop:Tomato", "district:Kandy", "all"]); ok("filter (area + crop) leads to 4 groups, most specific first; crop name is matched case-insensitively");
  assert.equal((await http("GET", G + "/groups/search?district=Atlantis", { token: A.token })).status, 400); assert.equal((await http("GET", G + "/groups/search?crop=Unobtainium", { token: A.token })).status, 400); assert.equal((await http("POST", G + "/groups/join", { token: A.token, body: { groupKey: "cropdist:Tomato|Nowhere" } })).status, 400); ok("made-up areas / crops / group keys are rejected");

  // ---------- joining + anonymity ----------
  const KEY = "cropdist:Tomato|Kandy";
  const ja = await http("POST", G + "/groups/join", { token: A.token, body: { groupKey: KEY } }); const jb = await http("POST", G + "/groups/join", { token: B.token, body: { groupKey: KEY } }); const jc = await http("POST", G + "/groups/join", { token: C.token, body: { groupKey: KEY } });
  assert.equal(ja.status, 200); const aliasA = ja.body.data.alias; assert.match(aliasA, /^[A-Z][a-z]+ [A-Z][A-Za-z ]+ \d{4}$/); assert.notEqual(aliasA, jb.body.data.alias);
  const again = await http("POST", G + "/groups/join", { token: A.token, body: { groupKey: KEY } }); assert.equal(again.body.data.alias, aliasA); assert.equal(again.body.data.memberCount, 3); ok(`anonymous aliases: "${aliasA}" / "${jb.body.data.alias}" / "${jc.body.data.alias}"; joining again keeps the same alias (no double count)`);
  const otherGroup = await http("POST", G + "/groups/join", { token: A.token, body: { groupKey: "all" } }); assert.notEqual(otherGroup.body.data.alias, aliasA); ok("same farmer, different group -> different alias (can't be linked across groups)");
  r = await http("GET", G + "/messages?groupKey=" + encodeURIComponent(KEY), { token: D.token }); assert.equal(r.status, 403); r = await http("POST", G + "/messages", { token: D.token, body: { groupKey: KEY, type: "text", text: "hello" } }); assert.equal(r.status, 403); ok("non-members can neither read nor post (403)");

  // ---------- posting + polling ----------
  const post = (who, extra) => http("POST", G + "/messages", { token: who.token, body: { groupKey: KEY, type: "text", ...extra } });
  r = await post(A, { text: "මගේ තක්කාලි කොළ කහ පාට වෙනවා. මොනවද කරන්න ඕනේ?" }); assert.equal(r.status, 201); assert.equal(r.body.data.mine, true); const m1 = r.body.data;
  r = await post(B, { text: "என் தக்காளி இலைகளிலும் அதே பிரச்சினை", replyToId: m1.id }); assert.equal(r.status, 201); assert.equal(r.body.data.replyTo.id, m1.id); assert.equal(r.body.data.replyTo.alias, aliasA); assert.match(r.body.data.replyTo.text, /තක්කාලි/); const m2 = r.body.data;
  ok("Sinhala and Tamil messages are accepted and stored correctly; replies carry a preview of the original");
  r = await http("GET", G + `/messages?groupKey=${encodeURIComponent(KEY)}`, { token: C.token }); assert.equal(r.body.data.length, 2); assert.equal(r.body.data[0].text, "මගේ තක්කාලි කොළ කහ පාට වෙනවා. මොනවද කරන්න ඕනේ?"); assert.ok(r.body.data.every((m) => m.mine === false)); const flat = JSON.stringify(r.body);
  for (const secret of [A.id, B.id, A.name, B.name, "neighbour1@", "+9477"]) assert.ok(!flat.includes(secret), "LEAK: " + secret); ok("what other farmers receive contains NO user ids, names, emails or phones — only aliases");
  r = await http("GET", G + `/messages?groupKey=${encodeURIComponent(KEY)}`, { token: A.token }); assert.equal(r.body.data.find((m) => m.id === m1.id).mine, true); ok("the sender sees their own messages flagged as 'mine'");
  await post(C, { text: "Try copper spray twice a week" }); r = await http("GET", G + `/messages?groupKey=${encodeURIComponent(KEY)}&after=${m2.id}`, { token: A.token }); assert.equal(r.body.data.length, 1); assert.equal(r.body.data[0].text, "Try copper spray twice a week"); ok("polling with 'after' returns only what is new");
  r = await http("GET", G + `/messages?groupKey=${encodeURIComponent(KEY)}&limit=2`, { token: A.token }); assert.equal(r.body.data.length, 2); assert.equal(r.body.hasMore, true); r = await http("GET", G + `/messages?groupKey=${encodeURIComponent(KEY)}&before=${r.body.data[0].id}`, { token: A.token }); assert.equal(r.body.data.length, 1); ok("older messages load with 'before' (paging works)");

  // ---------- safety rules ----------
  const blocked = { "call me on 0771234567": "phone", "my number +94 77 123 4567": "phone", "mail a.b@gmail.com": "email", "buy at www.cheapseeds.lk": "link", "you are a bastard": "profanity", "උඹ පකයා": "profanity", "தேவடியா": "profanity", "aaaaaaaaaaaaaaaaaaaa": "spam" };
  for (const [text, code] of Object.entries(blocked)) { r = await post(C, { text }); assert.equal(r.status, 400, text); assert.equal(r.body.code, code, text); } ok("blocked with a reason code: phone numbers (3 formats), email, links, English/Sinhala/Tamil swearing, spam");
  r = await post(C, { text: "prices 300 250 200 400 for 5 acres of Tomato in Rs. 45,000" }); assert.equal(r.status, 201); ok("normal talk about prices and quantities is NOT blocked");
  assert.equal((await post(C, { text: "   " })).status, 400); assert.equal((await post(C, { type: "banana", text: "x" })).status, 400); assert.equal((await post(C, { text: Array.from({ length: 400 }, (_, i) => `word${i}abc`).join(" ") })).status, 201); r = await http("GET", G + `/messages?groupKey=${encodeURIComponent(KEY)}&limit=1`, { token: C.token }); assert.ok(r.body.data[0].text.length <= 1000); ok("empty text refused, unknown type refused, over-long text trimmed to 1000 characters");

  // ---------- rate limit ----------
  const RKEY = "district:Kandy"; await http("POST", G + "/groups/join", { token: R.token, body: { groupKey: RKEY } }); let codes = [];
  for (let i = 0; i < 17; i++) { const x = await http("POST", G + "/messages", { token: R.token, body: { groupKey: RKEY, type: "text", text: `message number ${i} about my beans crop` } }); codes.push(x.status); }
  assert.equal(codes.filter((c) => c === 201).length, 15); assert.equal(codes.filter((c) => c === 429).length, 2); ok("rate limit: 15 messages a minute, then 429 'slow down'");

  // ---------- media ----------
  r = await post(A, { type: "image", imageBase64: PNG, text: "Look at this leaf" }); assert.equal(r.status, 201); assert.equal(r.body.data.type, "image"); const img = r.body.data;
  let media = await http("GET", G + "/media/" + img.media.id, { token: B.token, raw: true }); assert.equal(media.status, 200); assert.equal(media.headers.get("content-type"), "image/png"); assert.equal(Buffer.from(await media.arrayBuffer()).toString("base64"), PNG); ok("photo upload: stored, and members get back exactly the same bytes as image/png");
  assert.equal((await http("GET", G + "/media/" + img.media.id, { token: D.token, raw: true })).status, 403); assert.equal((await http("GET", G + "/media/" + img.media.id, { raw: true })).status, 401); ok("photos are private: non-members 403, no login 401");
  r = await post(A, { type: "image", imageBase64: b64(Buffer.from("this is a script, not a photo")) }); assert.equal(r.status, 400); assert.equal(r.body.code, "bad_format"); r = await post(A, { type: "image", imageBase64: JPEG }); assert.equal(r.status, 201); ok("the SERVER checks the real bytes: a text file pretending to be a photo is refused; a real JPEG header is accepted");
  r = await post(A, { type: "image", imageBase64: b64(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(700 * 1024)])) }); assert.equal(r.status, 413); ok("photos over 600 KB are refused (413)");
  r = await post(B, { type: "voice", voiceBase64: M4A, durationSec: 12.4 }); assert.equal(r.status, 201); assert.equal(r.body.data.media.durationSec, 12); const voice = r.body.data; media = await http("GET", G + "/media/" + voice.media.id, { token: C.token, raw: true }); assert.equal(media.headers.get("content-type"), "audio/mp4"); ok("voice message: stored with duration, played back as audio/mp4");
  assert.equal((await post(B, { type: "voice", voiceBase64: M4A, durationSec: 200 })).body.code, "too_long"); assert.equal((await post(B, { type: "voice", voiceBase64: b64(Buffer.from("not audio at all, just text")), durationSec: 5 })).status, 400); assert.equal((await post(B, { type: "voice", durationSec: 5 })).status, 400); ok("voice: over 90 seconds refused, non-audio bytes refused, missing audio refused");
  r = await post(A, { type: "scan", attachment: { kind: "scan", cropType: "Tomato", disease: "Late blight", severity: "moderate", confidencePercent: 87.4 } }); assert.equal(r.status, 201); assert.equal(r.body.data.attachment.confidencePercent, 87); assert.equal((await post(A, { type: "scan", attachment: { kind: "evil", x: 1 } })).status, 400); ok("a disease scan can be shared into the group (cleaned and limited); anything else is refused");

  // ---------- helpful / delete ----------
  r = await http("POST", G + "/messages/helpful", { token: B.token, body: { messageId: m1.id } }); assert.equal(r.body.helpfulCount, 1); assert.equal(r.body.iFoundHelpful, true); r = await http("POST", G + "/messages/helpful", { token: B.token, body: { messageId: m1.id } }); assert.equal(r.body.helpfulCount, 0); assert.equal((await http("POST", G + "/messages/helpful", { token: A.token, body: { messageId: m1.id } })).status, 400); ok("'this helped me' toggles on and off; you can't mark your own message");
  assert.equal((await http("POST", G + "/messages/delete", { token: B.token, body: { messageId: m1.id } })).status, 403); const own = (await post(A, { text: "delete me please" })).body.data; assert.equal((await http("POST", G + "/messages/delete", { token: A.token, body: { messageId: own.id } })).status, 200); r = await http("GET", G + `/messages?groupKey=${encodeURIComponent(KEY)}&limit=100`, { token: B.token }); assert.ok(!r.body.data.some((m) => m.id === own.id)); ok("you can delete your own message (gone for everyone) but not someone else's");

  // ---------- reports, hiding, blocking ----------
  const bad = (await post(A, { text: "this is a bad message" })).body.data;
  assert.equal((await http("POST", G + "/messages/report", { token: A.token, body: { messageId: bad.id, reason: "abuse" } })).status, 400); r = await http("POST", G + "/messages/report", { token: B.token, body: { messageId: bad.id, reason: "abuse" } }); assert.equal(r.status, 200); r = await http("POST", G + "/messages/report", { token: B.token, body: { messageId: bad.id, reason: "abuse" } }); assert.match(r.body.message, /already reported/); ok("can't report yourself; reporting twice counts once");
  let visible = async (who) => (await http("GET", G + `/messages?groupKey=${encodeURIComponent(KEY)}&limit=100`, { token: who.token })).body.data.some((m) => m.id === bad.id);
  assert.equal(await visible(C), true); await http("POST", G + "/messages/report", { token: C.token, body: { messageId: bad.id, reason: "personal_info" } }); assert.equal(await visible(C), true); await http("GET", G + "/groups", { token: A.token });
  await http("POST", G + "/groups/join", { token: D.token, body: { groupKey: KEY } }); await http("POST", G + "/messages/report", { token: D.token, body: { messageId: bad.id, reason: "spam" } });
  assert.equal(await visible(C), false); const mineView = (await http("GET", G + `/messages?groupKey=${encodeURIComponent(KEY)}&limit=100`, { token: A.token })).body.data; assert.equal(mineView.find((m) => m.id === bad.id), undefined); ok("3 different farmers report -> the message is auto-hidden from everyone until an admin decides");
  r = await http("POST", G + "/groups/block", { token: C.token, body: { groupKey: KEY, alias: aliasA, blocked: true } }); assert.equal(r.status, 200); r = await http("GET", G + `/messages?groupKey=${encodeURIComponent(KEY)}&limit=100`, { token: C.token }); assert.ok(!r.body.data.some((m) => m.alias === aliasA)); r = await http("GET", G + `/messages?groupKey=${encodeURIComponent(KEY)}&limit=100`, { token: B.token }); assert.ok(r.body.data.some((m) => m.alias === aliasA)); assert.equal((await http("POST", G + "/groups/block", { token: C.token, body: { groupKey: KEY, alias: jc.body.data.alias } })).status, 400); ok("blocking an alias hides them for ME only; others still see them; you can't block yourself");
  await http("POST", G + "/groups/block", { token: C.token, body: { groupKey: KEY, alias: aliasA, blocked: false } });

  // ---------- groups list / unread / mute ----------
  r = await http("GET", G + "/groups", { token: D.token }); const mine = r.body.data.find((g) => g.key === KEY); assert.ok(mine.unread >= 0 && mine.memberCount === 4); r = await http("GET", G + "/groups", { token: B.token }); const bg = r.body.data.find((g) => g.key === KEY); await post(C, { text: "new message for unread test" }); r = await http("GET", G + "/groups", { token: B.token }); assert.equal(r.body.data.find((g) => g.key === KEY).unread, bg.unread + 1); await http("GET", G + `/messages?groupKey=${encodeURIComponent(KEY)}`, { token: B.token }); r = await http("GET", G + "/groups", { token: B.token }); assert.equal(r.body.data.find((g) => g.key === KEY).unread, 0); ok("unread counts go up with new messages and reset when the chat is opened");
  await http("POST", G + "/groups/mute", { token: B.token, body: { groupKey: KEY, muted: true } }); await post(C, { text: "another one while muted" }); r = await http("GET", G + "/groups", { token: B.token }); assert.equal(r.body.data.find((g) => g.key === KEY).unread, 0); assert.equal(r.body.data.find((g) => g.key === KEY).muted, true); ok("muted groups show no unread badge");
  await http("POST", G + "/groups/leave", { token: D.token, body: { groupKey: KEY } }); assert.equal((await http("GET", G + `/messages?groupKey=${encodeURIComponent(KEY)}`, { token: D.token })).status, 403); ok("leaving a group closes access");

  // ---------- admin moderation ----------
  r = await http("GET", "/admin/chat/reports?status=open", { token: ADMIN.token }); assert.equal(r.status, 200); const item = r.body.data.find((x) => x.messageId === bad.id); assert.ok(item); assert.equal(item.reports, 3); assert.deepEqual(item.reasons.sort(), ["abuse", "personal_info", "spam"]); assert.equal(item.sender.name, A.name); assert.ok(item.sender.phone); assert.equal(item.messageStatus, "hidden"); ok("admin sees the reported message with reasons AND the real sender (name, phone) — the only place identity is revealed");
  r = await http("POST", "/admin/chat/messages/restore", { token: ADMIN.token, body: { messageId: bad.id } }); assert.equal(r.status, 200); assert.equal(await visible(C), true); assert.equal((await http("GET", "/admin/chat/reports?status=dismissed", { token: ADMIN.token })).body.data.length >= 1, true); ok("admin restores a falsely-reported message: visible again, reports dismissed");
  r = await http("POST", "/admin/chat/messages/remove", { token: ADMIN.token, body: { messageId: img.id, reason: "unsafe photo" } }); assert.equal(r.status, 200); assert.equal((await http("GET", G + "/media/" + img.media.id, { token: B.token, raw: true })).status, 404); r = await http("GET", G + `/messages?groupKey=${encodeURIComponent(KEY)}&limit=100`, { token: B.token }); assert.ok(!r.body.data.some((m) => m.id === img.id)); ok("admin removes a photo: message gone AND the photo bytes deleted");
  r = await http("POST", "/admin/chat/ban", { token: ADMIN.token, body: { userId: A.id, days: 3 } }); assert.equal(r.status, 200); r = await post(A, { text: "am I banned?" }); assert.equal(r.status, 403); assert.equal(r.body.code, "banned"); assert.equal((await http("POST", G + "/groups/join", { token: A.token, body: { groupKey: "crop:Carrot" } })).status, 403); r = await http("POST", "/admin/chat/ban", { token: ADMIN.token, body: { userId: A.id, unban: true } }); assert.equal(r.status, 200); assert.equal((await post(A, { text: "I can chat again" })).status, 201); ok("ban: cannot post or join; unban restores it");
  assert.equal((await http("POST", "/admin/chat/ban", { token: ADMIN.token, body: { userId: A.id, days: 0 } })).status, 400); assert.equal((await http("POST", "/admin/chat/ban", { token: ADMIN.token, body: { userId: BUYER.id, days: 3 } })).status, 404); ok("ban validates input, and only farmers can be banned");
  r = await http("GET", "/admin/chat/stats", { token: ADMIN.token }); assert.ok(r.body.data.messages > 5 && r.body.data.memberships >= 5 && Array.isArray(r.body.data.busiestGroups)); ok("admin chat statistics available");

  // ---------- outbreak alert as a system message ----------
  const { postOutbreakAlert } = require("./controllers/groupChatController"); const sys = await postOutbreakAlert({ farmerId: A.id, cropType: "Tomato", disease: "Late blight", count: 6 }); assert.ok(sys); assert.equal(sys.type, "system"); assert.equal(sys.alias, "AgriLink");
  assert.equal(await postOutbreakAlert({ farmerId: A.id, cropType: "Tomato", disease: "Late blight", count: 7 }), null); assert.equal(await postOutbreakAlert({ farmerId: R.id, cropType: "Carrot", disease: "X", count: 5 }), null);
  r = await http("GET", G + `/messages?groupKey=${encodeURIComponent(KEY)}&limit=100`, { token: B.token }); const s = r.body.data.find((m) => m.type === "system"); assert.equal(s.attachment.disease, "Late blight"); assert.equal(s.mine, false); ok("an outbreak detected by the scanner posts an alert in the crop+district group — once a day per disease, and only if someone is in the group");

  // ---------- translate (no API key on this test server -> graceful) ----------
  r = await http("POST", G + "/messages/translate", { token: B.token, body: { messageId: m1.id, target: "en" } }); assert.equal(r.status, 200); assert.equal(typeof r.body.translated, "string"); ok("translate endpoint answers safely even without an AI key (returns the original text)");
  await User.deleteOne({ email: "admin.chat@agrilink.lk" }); await mongoose.disconnect();
  console.log(`\nALL ${passed} GROUP-CHAT END-TO-END TESTS PASSED`);
})().catch(async (e) => { console.error("\nFAILED:", e.message); console.error((e.stack || "").split("\n").slice(1, 4).join("\n")); try { await mongoose.disconnect(); } catch (_) {} process.exit(1); });
