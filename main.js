// ===== CONFIG =====
const SHEET_WEB_APP_URL      = "https://script.google.com/macros/s/AKfycbwF4oukVU_5jSvTDq89Fv5wIVlgrdMiihyJeKdiR59P_DwSXVx78QphXcqZNiPYyCF-/exec"; // Web App VocabScript (/exec)
const LOGIN_API_URL          = "https://script.google.com/macros/s/AKfycbzTEPhty8799D5Q6LbOTcn10FoUreY2C_kfvOJPCaN2R5pq38DeCOPEsM7mKncsiVFI/exec"; // Web App LoginScript (/exec)
const USER_STORAGE_KEY       = "vocab_user_profile";
const GEMINI_KEY_STORAGE_KEY = "vocab_gemini_api_key";
const STATUS_CONFIG = [
    { value: "new",      label: "Mới học",        className: "status-new" },
    { value: "learning", label: "Đang học",       className: "status-learning" },
    { value: "review",   label: "Ôn lại",         className: "status-review" },
    { value: "mastered", label: "Thuộc rồi",      className: "status-mastered" },
    // ví dụ thêm status mới:
    // { value: "forgot",   label: "Quên rồi",       className: "status-forgot" },
];
let words = [];
let currentUser = null;
let editingIndex = -1;

// ===== DOM ELEMENTS =====
const wordForm        = document.getElementById("word-form");
const wordInput       = document.getElementById("word");
const meaningInput    = document.getElementById("meaning");
const folderInput     = document.getElementById("folder");
const folderList      = document.getElementById("folder-list");
const ipaInput        = document.getElementById("ipa");
const typeInput       = document.getElementById("type");
const statusSelect    = document.getElementById("status");
const sentenceInput   = document.getElementById("sentence");

const wordSubmitButton = document.getElementById("word-submit-button");
const cancelEditButton = document.getElementById("cancel-edit-button");
const editHint         = document.getElementById("edit-hint");

const wordListEl      = document.getElementById("word-list");
const wordEmptyEl     = document.getElementById("word-empty");
const totalCountPill  = document.getElementById("total-count-pill");
const streakText      = document.getElementById("streak-text");
const reloadButton    = document.getElementById("reload-button");
const searchInput     = document.getElementById("search-input");

const userDisplay     = document.getElementById("user-display");
const logoutButton    = document.getElementById("logout-button");

// Đổi mật khẩu
const changePwButton  = document.getElementById("change-password-button");
const changePwModal   = document.getElementById("change-password-modal");
const changePwForm    = document.getElementById("change-password-form");
const oldPwInput      = document.getElementById("old-password");
const newPwInput      = document.getElementById("new-password");
const confirmPwInput  = document.getElementById("confirm-password");
const cancelChangePw  = document.getElementById("cancel-change-password");
const changePwMessage = document.getElementById("change-password-message");

// AI modal (spinner)
const aiButton    = document.getElementById("ai-suggest-button");
const aiModal     = document.getElementById("ai-modal");
const aiWordLabel = document.getElementById("ai-word-label");

// Toast
const toastEl = document.getElementById("toast");

// Popup nhập Gemini key
const geminiModal   = document.getElementById("gemini-key-modal");
const geminiForm    = document.getElementById("gemini-key-form");
const geminiInput   = document.getElementById("gemini-key-input");
const geminiCancel  = document.getElementById("cancel-gemini-key");
const geminiMessage = document.getElementById("gemini-key-message");

// ===== Toast helper =====
function showToast(message, type = "info") {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.className = "";
    toastEl.id = "toast";
    toastEl.classList.add(type);
    toastEl.style.opacity = 1;
    toastEl.style.pointerEvents = "auto";
    toastEl.classList.add("show");

    setTimeout(() => {
        toastEl.classList.remove("show");
        toastEl.style.opacity = 0;
        toastEl.style.pointerEvents = "none";
    }, 2500);
}

// ===== LOGIN =====
function requireLoginOrRedirect() {
    try {
        const raw = localStorage.getItem(USER_STORAGE_KEY);
        if (!raw) {
            window.location.href = "login.html";
            return;
        }
        currentUser = JSON.parse(raw);
        if (!currentUser || !currentUser.email) {
            window.location.href = "login.html";
            return;
        }

        // Nếu profile có geminiKey nhưng localStorage chưa có => sync từ sheet
        if (currentUser.geminiKey && !localStorage.getItem(GEMINI_KEY_STORAGE_KEY)) {
            localStorage.setItem(GEMINI_KEY_STORAGE_KEY, currentUser.geminiKey);
        }

    } catch (e) {
        console.error("Lỗi đọc user profile:", e);
        window.location.href = "login.html";
        return;
    }
    updateUserUI();
}

function updateUserUI() {
    if (!userDisplay) return;
    if (currentUser && currentUser.email) {
        // chỉ hiển thị gmail đăng nhập
        userDisplay.textContent = currentUser.email;
    } else {
        userDisplay.textContent = "Khách (chưa đăng nhập)";
    }
}

if (logoutButton) {
    logoutButton.addEventListener("click", () => {
        localStorage.removeItem(USER_STORAGE_KEY);
        localStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
        window.location.href = "login.html";
    });
}

// ===== ĐỔI MẬT KHẨU =====
function openChangePwModal() {
    if (!currentUser || !currentUser.email) {
        alert("Bạn cần đăng nhập lại trước khi đổi mật khẩu.");
        return;
    }
    changePwMessage.textContent = "";
    changePwMessage.className = "modal-message";
    oldPwInput.value = "";
    newPwInput.value = "";
    confirmPwInput.value = "";
    changePwModal.style.display = "flex";
}
function closeChangePwModal() {
    changePwModal.style.display = "none";
}

// ===== GEMINI KEY =====
function getGeminiKey() {
    return localStorage.getItem(GEMINI_KEY_STORAGE_KEY) || "";
}
function openGeminiModal() {
    if (!currentUser || !currentUser.email) {
        alert("Bạn cần đăng nhập trước khi thiết lập Gemini key.");
        return;
    }
    geminiMessage.textContent = "";
    geminiMessage.className = "modal-message";
    geminiInput.value = "";
    geminiModal.style.display = "flex";
}
function closeGeminiModal() {
    geminiModal.style.display = "none";
}

// ===== VOCAB FROM SHEET =====
async function fetchWordsFromSheet() {
    if (!currentUser || !currentUser.email) return;

    const url = `${SHEET_WEB_APP_URL}?userEmail=${encodeURIComponent(
        currentUser.email.toLowerCase()
    )}`;

    try {
        const res = await fetch(url, { method: "GET" });
        const data = await res.json();

        if (data.status === "success" && Array.isArray(data.words)) {
            words = data.words.map(w => ({
                rowIndex: w.rowIndex || null,
                word: w.word || "",
                folder: w.folder || "",
                ipa: w.ipa || "",
                type: w.type || "",
                meaning: w.meaning || "",
                sentence: w.sentence || "",
                dateAdded: w.dateAdded || "",
                status: w.status || ""
            }));
        } else {
            console.warn("Dữ liệu vocab không hợp lệ:", data);
            words = [];
        }
    } catch (err) {
        console.error("Lỗi fetch vocab:", err);
        words = [];
    }
}

// ===== SEND VOCAB TO SHEET =====
function sendWordToGoogleSheet_Add(word) {
    if (!currentUser || !currentUser.email) {
        alert("Chưa đăng nhập, không thể lưu từ.");
        return;
    }

    const payload = {
        ...word,
        userEmail: currentUser.email.toLowerCase(),
        action: "add"
    };

    fetch(SHEET_WEB_APP_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === "success" && data.rowIndex) {
            const last = words[words.length - 1];
            if (last && last.rowIndex == null) {
                last.rowIndex = data.rowIndex;
            }
            showToast("Đã lưu từ mới lên Google Sheets", "success");
        } else {
            console.warn("Gửi Google Sheets (add) lỗi:", data);
            showToast("Lưu từ mới lên Sheets bị lỗi", "error");
        }
    })
    .catch(err => {
        console.error("POST Sheets add error:", err);
        showToast("Không kết nối được Google Sheets", "error");
    });
}

function sendWordToGoogleSheet_Update(index, word) {
    const item = words[index];
    if (!item || !item.rowIndex) {
        alert("Không tìm được rowIndex để cập nhật. Hãy tải lại danh sách rồi thử lại.");
        return;
    }

    const payload = {
        ...word,
        userEmail: currentUser.email.toLowerCase(),
        action: "update",
        rowIndex: item.rowIndex
    };

    return fetch(SHEET_WEB_APP_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
    }).then(res => res.json());
}

function sendWordToGoogleSheet_Delete(index) {
    const item = words[index];
    if (!item || !item.rowIndex) {
        alert("Không tìm được rowIndex để xóa. Hãy tải lại danh sách rồi thử lại.");
        return Promise.reject("no rowIndex");
    }

    const payload = {
        userEmail: currentUser.email.toLowerCase(),
        action: "delete",
        rowIndex: item.rowIndex
    };

    return fetch(SHEET_WEB_APP_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
    }).then(res => res.json());
}

// ===== UI HELPERS =====

function updateFolderSuggestions() {
    if (!folderList) return;

    // lấy folder duy nhất từ danh sách từ
    const set = new Set();

    words.forEach(w => {
        if (w.folder && w.folder.trim() !== "") {
            set.add(w.folder.trim());
        }
    });

    // xoá option cũ
    folderList.innerHTML = "";

    // tạo option mới
    set.forEach(f => {
        const opt = document.createElement("option");
        opt.value = f;
        folderList.appendChild(opt);
    });
}
function getTypeTagClass(type) {
    if (!type) return "tag-other";
    const t = type.toLowerCase();
    if (t.includes("noun")) return "tag-A1";
    if (t.includes("verb")) return "tag-A2";
    if (t.includes("adj"))  return "tag-B1";
    if (t.includes("adv"))  return "tag-B2";
    if (t.includes("phrase")) return "tag-C1";
    return "tag-other";
}
function getStatusClass(status) {
    const st = STATUS_CONFIG.find(s => s.value === status);
    return st ? st.className : "status-new";
}

function updateCount() {
    if (!totalCountPill) return;
    const span = totalCountPill.querySelector("span:last-child");
    if (span) span.textContent = words.length + " từ";
}
//
function computeStreakDays(wordsArray) {
    let earliest = null;

    for (const w of wordsArray) {
        if (!w.dateAdded) continue;

        const d = new Date(w.dateAdded);
        if (isNaN(d.getTime())) continue;

        if (!earliest || d < earliest) {
            earliest = d;
        }
    }

    if (!earliest) return 0;

    const today = new Date();

    // chỉ tính theo ngày (bỏ giờ)
    const start = new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate());
    const end   = new Date(today.getFullYear(),   today.getMonth(),   today.getDate());

    const diffMs   = end - start;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1; // +1 để tính cả ngày đầu tiên

    return Math.max(diffDays, 1);
}

function updateStreak() {
    if (!streakText) return;

    const days = computeStreakDays(words);
    let label;
    if (days <= 0) label = "0 ngày";
    else if (days === 1) label = "1 ngày";
    else label = days + " ngày";

    streakText.innerHTML = `Chuỗi ngày học: <b>${label}</b>`;
}

// Speech
function playPronunciation(text) {
    if (!text) return;
    if (!("speechSynthesis" in window)) {
        alert("Trình duyệt không hỗ trợ phát âm.");
        return;
    }
    window.speechSynthesis.cancel();

    const utter = new SpeechSynthesisUtterance(text);
    utter.lang  = "en-US";
    utter.rate  = 0.95;
    utter.pitch = 1.0;
    window.speechSynthesis.speak(utter);
}

// Edit mode
function setEditMode(index) {
    editingIndex = index;
    if (index < 0) {
        if (wordSubmitButton) wordSubmitButton.textContent = "+ Thêm vào Google Sheets";
        if (cancelEditButton) cancelEditButton.style.display = "none";
        if (editHint)         editHint.style.display = "none";

        wordInput.value     = "";
        meaningInput.value  = "";
        folderInput.value   = "";
        ipaInput.value      = "";
        typeInput.value     = "";
        sentenceInput.value = "";
        statusSelect.value  = "new";
        return;
    }

    const w = words[index];
    if (!w) return;

    wordInput.value     = w.word || "";
    meaningInput.value  = w.meaning || "";
    folderInput.value   = w.folder || "";
    ipaInput.value      = w.ipa || "";
    typeInput.value     = w.type || "";
    sentenceInput.value = w.sentence || "";
    statusSelect.value  = w.status || "new";

    if (wordSubmitButton) wordSubmitButton.textContent = "💾 Lưu thay đổi";
    if (cancelEditButton) cancelEditButton.style.display = "inline-flex";
    if (editHint) {
        editHint.style.display = "inline";
        editHint.textContent   = `Đang sửa từ: "${w.word}"`;
    }
}

// Render list
function renderWords(filterText = "") {
    const rows = Array.from(wordListEl.querySelectorAll(".word-row"));
    rows.forEach((row, index) => {
        if (index === 0) return;
        row.remove();
    });

    let visibleCount = 0;
    const text = filterText.trim().toLowerCase();

    words.forEach((w, index) => {
        if (text) {
            const match = (
                (w.word || "")   + " " +
                (w.meaning || "")+ " " +
                (w.folder || "")
            ).toLowerCase().includes(text);
            if (!match) return;
        }

        visibleCount++;

        const row = document.createElement("div");
        row.className = "word-row";

        const wordCell = document.createElement("div");
        wordCell.textContent = w.word;

        const ipaCell = document.createElement("div");
        ipaCell.textContent = w.ipa || "—";

        const meaningCell = document.createElement("div");
        meaningCell.textContent = w.meaning;

        const sentenceCell = document.createElement("div");
        sentenceCell.textContent = w.sentence || "—";

        const typeCell = document.createElement("div");
        const typeSpan = document.createElement("span");
        typeSpan.className = "tag-level " + getTypeTagClass(w.type);
        typeSpan.textContent = w.type || "—";
        typeCell.appendChild(typeSpan);

        const folderCell = document.createElement("div");
        folderCell.textContent = w.folder || "—";

        const statusCell = document.createElement("div");
        const statusSpan = document.createElement("span");
        statusSpan.className = "status-pill " + getStatusClass(w.status);
        statusSpan.textContent = w.status || "new";
        statusCell.appendChild(statusSpan);

        const actionsCell = document.createElement("div");
        actionsCell.className = "word-actions";

        const soundBtn = document.createElement("button");
        soundBtn.type = "button";
        soundBtn.textContent = "🔊";
        soundBtn.title = "Phát âm word";
        soundBtn.className = "mini-btn voice";
        soundBtn.addEventListener("click", () => {
            playPronunciation(w.word);
        });

        const editBtn = document.createElement("button");
        editBtn.type = "button";
        editBtn.textContent = "Sửa";
        editBtn.className = "mini-btn edit";
        editBtn.addEventListener("click", () => {
            setEditMode(index);
        });

        const delBtn = document.createElement("button");
        delBtn.type = "button";
        delBtn.textContent = "Xóa";
        delBtn.className = "mini-btn delete";
        delBtn.addEventListener("click", async () => {
            if (!confirm(`Xóa từ "${w.word}"?`)) return;
            try {
                const data = await sendWordToGoogleSheet_Delete(index);
                if (data && data.status === "success") {
                    words.splice(index, 1);
                    renderWords(searchInput.value);
                    updateCount();
                    if (editingIndex === index) {
                        setEditMode(-1);
                    }
                    showToast("Đã xóa từ khỏi Sheets", "success");
                } else {
                    alert(data && data.message ? data.message : "Xóa thất bại");
                    showToast("Xóa từ thất bại", "error");
                }
            } catch (err) {
                console.error("Delete error:", err);
                alert("Lỗi khi xóa từ.");
                showToast("Lỗi khi xóa từ", "error");
            }
        });

        actionsCell.appendChild(soundBtn);
        actionsCell.appendChild(editBtn);
        actionsCell.appendChild(delBtn);

        row.appendChild(wordCell);
        row.appendChild(ipaCell);
        row.appendChild(meaningCell);
        row.appendChild(sentenceCell);
        row.appendChild(typeCell);
        row.appendChild(folderCell);
        row.appendChild(statusCell);
        row.appendChild(actionsCell);

        wordListEl.appendChild(row);
    });

    wordEmptyEl.style.display = (words.length === 0 || visibleCount === 0) ? "block" : "none";
}

// ===== AI – GỌI GEMINI =====
async function aiGenerateWordData(word) {
    const key = getGeminiKey();
    if (!key) throw new Error("NO_GEMINI_KEY");

    const prompt = `
Bạn là trợ lý tạo từ vựng tiếng Anh cho người Việt.
Cho từ: "${word}"

Hãy trả về đúng JSON, KHÔNG có text nào ngoài JSON:

{
  "ipa": "phiên âm IPA",
  "type": "noun/verb/adj/adv/phrase",
  "meaning": "nghĩa tiếng Việt ngắn gọn",
  "sentence": "1 câu ví dụ đơn giản",
  "status": "new"
}
`;

    const body = { contents: [ { parts: [ { text: prompt } ] } ] };

    const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-robotics-er-1.5-preview:generateContent?key=" + encodeURIComponent(key),
    {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }
    );

    if (!res.ok) {
        throw new Error("Gemini HTTP " + res.status);
    }

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    const start = text.indexOf("{");
    const end   = text.lastIndexOf("}");
    if (start === -1 || end === -1) {
        console.error("AI response:", text);
        throw new Error("AI không trả về JSON hợp lệ");
    }

    const jsonStr = text.slice(start, end + 1);
    return JSON.parse(jsonStr);
}

// Test key có kết nối được server không
async function testGeminiKey(key) {
    const body = {
        contents: [
            { parts: [ { text: "ping" } ] }
        ]
    };

    const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=" + encodeURIComponent(key),
    {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }
    );

    if (!res.ok) {
        throw new Error("Gemini HTTP " + res.status);
    }

    const data = await res.json();
    if (!data.candidates || !data.candidates.length) {
        throw new Error("Gemini không trả về candidates");
    }
    // nếu tới đây là coi như key dùng được
}

// AI modal spinner
function openAiModal(word) {
    if (!aiModal) return;
    if (aiWordLabel) aiWordLabel.textContent = `Từ: "${word}"`;
    aiModal.style.display = "flex";
}
function closeAiModal() {
    if (!aiModal) return;
    aiModal.style.display = "none";
}

// ===== EVENTS =====
if (wordForm) {
    wordForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        const word     = (wordInput.value || "").trim();
        const meaning  = (meaningInput.value || "").trim();
        const folder   = (folderInput.value || "").trim();
        const ipa      = (ipaInput.value || "").trim();
        const type     = (typeInput.value || "").trim();
        const status   = statusSelect.value || "new";
        const sentence = (sentenceInput.value || "").trim();

        if (!word || !meaning) return;

        const newWord = { word, meaning, folder, ipa, type, sentence, status };

        if (editingIndex < 0) {
            const now = new Date();
            const localDate = now.toISOString().slice(0, 10); // yyyy-MM-dd

            words.push({
                rowIndex : null,
                ...newWord,
                dateAdded: localDate   // dùng để tính streak tạm thời
            });
            renderWords(searchInput.value);
            updateCount();
            updateStreak();             // cập nhật chuỗi ngày học ngay sau khi thêm
            updateFolderSuggestions();
            sendWordToGoogleSheet_Add(newWord);
            setEditMode(-1);
        }else {
            try {
                const data = await sendWordToGoogleSheet_Update(editingIndex, newWord);
                if (data && data.status === "success") {
                    const old = words[editingIndex];
                    words[editingIndex] = { ...old, ...newWord };
                    renderWords(searchInput.value);
                    setEditMode(-1);
                    updateFolderSuggestions();
                    showToast("Đã cập nhật từ trên Sheets", "success");
                } else {
                    alert(data && data.message ? data.message : "Cập nhật thất bại");
                    showToast("Cập nhật từ thất bại", "error");
                }
            } catch (err) {
                console.error("Update error:", err);
                alert("Lỗi khi cập nhật từ.");
                showToast("Lỗi khi cập nhật từ", "error");
            }
        }
    });
}

if (cancelEditButton) {
    cancelEditButton.addEventListener("click", () => {
        setEditMode(-1);
    });
}

if (reloadButton) {
    reloadButton.addEventListener("click", async () => {
        await fetchWordsFromSheet();
        renderWords(searchInput.value);
        updateCount();
        updateStreak();
        updateFolderSuggestions();
        setEditMode(-1);
        showToast("Đã tải lại từ Google Sheets", "info");
    });
}

if (searchInput) {
    searchInput.addEventListener("input", e => {
        renderWords(e.target.value);
    });
}

// Đổi mật khẩu events
if (changePwButton) {
    changePwButton.addEventListener("click", openChangePwModal);
}
if (cancelChangePw) {
    cancelChangePw.addEventListener("click", closeChangePwModal);
}
if (changePwModal) {
    changePwModal.addEventListener("click", e => {
        if (e.target === changePwModal) closeChangePwModal();
    });
}
if (changePwForm) {
    changePwForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (!currentUser || !currentUser.email) {
            changePwMessage.textContent = "Bạn cần đăng nhập lại.";
            changePwMessage.className = "modal-message error";
            return;
        }

        const oldPw     = (oldPwInput.value || "").trim();
        const newPw     = (newPwInput.value || "").trim();
        const confirmPw = (confirmPwInput.value || "").trim();

        if (!oldPw || !newPw || !confirmPw) {
            changePwMessage.textContent = "Vui lòng nhập đầy đủ các trường.";
            changePwMessage.className = "modal-message error";
            return;
        }
        if (newPw.length < 4) {
            changePwMessage.textContent = "Mật khẩu mới nên dài ít nhất 4 ký tự.";
            changePwMessage.className = "modal-message error";
            return;
        }
        if (newPw !== confirmPw) {
            changePwMessage.textContent = "Mật khẩu mới nhập lại không khớp.";
            changePwMessage.className = "modal-message error";
            return;
        }

        changePwMessage.textContent = "Đang xử lý...";
        changePwMessage.className = "modal-message";

        try {
            const res = await fetch(LOGIN_API_URL, {
                method: "POST",
                mode: "cors",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({
                    action: "changePassword",
                    email: currentUser.email,
                    oldPassword: oldPw,
                    newPassword: newPw
                })
            });

            if (!res.ok) {
                const text = await res.text();
                console.error("Change password HTTP error:", res.status, text);
                changePwMessage.textContent = "Lỗi server: " + res.status;
                changePwMessage.className = "modal-message error";
                return;
            }

            const data = await res.json();
            if (data.status === "success") {
                changePwMessage.textContent = "Đổi mật khẩu thành công!";
                changePwMessage.className = "modal-message success";
            } else {
                changePwMessage.textContent = data.message || "Đổi mật khẩu thất bại.";
                changePwMessage.className = "modal-message error";
            }
        } catch (err) {
            console.error("Change password fetch error:", err);
            changePwMessage.textContent = "Không kết nối được tới server.";
            changePwMessage.className = "modal-message error";
        }
    });
}

// Gemini key events
if (geminiCancel) {
    geminiCancel.addEventListener("click", closeGeminiModal);
}
if (geminiModal) {
    geminiModal.addEventListener("click", e => {
        if (e.target === geminiModal) closeGeminiModal();
    });
}
if (geminiForm) {
    geminiForm.addEventListener("submit", async (e) => {
        e.preventDefault();

        if (!currentUser || !currentUser.email) {
            geminiMessage.textContent = "Bạn cần đăng nhập lại.";
            geminiMessage.className = "modal-message error";
            return;
        }

        const key = (geminiInput.value || "").trim();
        if (!key) {
            geminiMessage.textContent = "Vui lòng nhập Gemini API key.";
            geminiMessage.className = "modal-message error";
            return;
        }

        geminiMessage.textContent = "Đang kiểm tra key với Gemini server...";
        geminiMessage.className = "modal-message";

        try {
            // 1. Test kết nối tới Gemini
            await testGeminiKey(key);

            // 2. Lưu localStorage
            localStorage.setItem(GEMINI_KEY_STORAGE_KEY, key);

            // 3. Gửi lên server để lưu vào cột C (sheet Users)
            const res = await fetch(LOGIN_API_URL, {
                method: "POST",
                mode: "cors",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({
                    action: "saveGeminiKey",
                    email : currentUser.email,
                    key   : key
                })
            });

            let data = null;
            if (res.ok) {
                data = await res.json();
            } else {
                const txt = await res.text();
                console.error("saveGeminiKey HTTP error:", res.status, txt);
            }

            if (data && data.status === "success") {
                // cập nhật profile trong localStorage
                currentUser.geminiKey = key;
                localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(currentUser));

                geminiMessage.textContent = "Key hợp lệ! Đã lưu cho tài khoản này.";
                geminiMessage.className   = "modal-message success";
                showToast("Lưu Gemini key thành công", "success");
                setTimeout(closeGeminiModal, 800);
            } else {
                geminiMessage.textContent = (data && data.message) || "Lưu key lên sheet bị lỗi (nhưng key vẫn dùng được).";
                geminiMessage.className   = "modal-message error";
                showToast("Lưu key lên sheet bị lỗi", "error");
            }

        } catch (err) {
            console.error("Gemini key error:", err);
            geminiMessage.textContent = "Key không kết nối được với Gemini: " + err.message;
            geminiMessage.className   = "modal-message error";
            showToast("Gemini key không kết nối được server", "error");
        }
    });
}

// AI button
if (aiButton) {
    aiButton.addEventListener("click", async () => {
        const word = (wordInput.value || "").trim();
        if (!word) {
            alert("Hãy nhập Word trước khi dùng AI gợi ý.");
            return;
        }

        // Nếu chưa có key (cột C trống + localStorage trống) => popup
        if (!getGeminiKey()) {
            showToast("Bạn chưa thiết lập Gemini API key", "info");
            openGeminiModal();
            return;
        }

        aiButton.disabled = true;
        aiButton.textContent = "⏳ AI đang nghĩ...";
        openAiModal(word);

        try {
            const aiData = await aiGenerateWordData(word);

            ipaInput.value      = aiData.ipa      || "";
            typeInput.value     = aiData.type     || "";
            meaningInput.value  = aiData.meaning  || "";
            sentenceInput.value = aiData.sentence || "";
            statusSelect.value  = aiData.status   || "new";

            showToast("AI đã gợi ý nội dung cho từ", "success");
        } catch (err) {
            console.error("AI error:", err);
            if (err.message === "NO_GEMINI_KEY") {
                showToast("Chưa có Gemini key", "error");
                openGeminiModal();
            } else {
                alert("AI lỗi: " + err.message);
                showToast("AI gợi ý thất bại", "error");
            }
        } finally {
            closeAiModal();
            aiButton.disabled = false;
            aiButton.textContent = "🤖 AI gợi ý nội dung";
        }
    });
}

// ===== INIT =====
function initStatusSelectOptions() {
    if (!statusSelect) return;
    statusSelect.innerHTML = ""; // xoá option cũ trong HTML

    STATUS_CONFIG.forEach(st => {
        const opt = document.createElement("option");
        opt.value = st.value;
        opt.textContent = st.label;
        statusSelect.appendChild(opt);
    });
}
(async function init() {
    requireLoginOrRedirect();
    initStatusSelectOptions();
    await fetchWordsFromSheet();
    renderWords();
    updateCount();
    updateStreak();
    updateFolderSuggestions();   // 👈 thêm dòng này
})();
