// ===== CONFIG =====
const SHEET_WEB_APP_URL = "YOUR_VOCAB_WEBAPP_URL"; 
const USER_STORAGE_KEY  = "vocab_user_profile";

// ===== STATE =====
let words = [];
let currentUser = null;
let activeFolder = "ALL";

let flashIndices = [];
let flashCurrent = 0;
let flashShowFront = true;

// ===== DOM =====
const folderRow = document.getElementById("flash-folder-row");
const flashStartBtn = document.getElementById("flash-start");

const flashCard = document.getElementById("flashcard");
const flashWordEl = document.getElementById("flashcard-word");
const flashExtraEl = document.getElementById("flashcard-extra");
const flashProgEl = document.getElementById("flashcard-progress");

const prevBtn = document.getElementById("flash-prev");
const nextBtn = document.getElementById("flash-next");
const flipBtn = document.getElementById("flash-flip");

// Toast
const toastEl = document.getElementById("toast");
function showToast(msg, type="info") {
    toastEl.textContent = msg;
    toastEl.className = "show " + type;
    setTimeout(()=> toastEl.className="", 2000);
}

// ===== LOGIN =====
function requireLoginOrRedirect(){
    const raw = localStorage.getItem(USER_STORAGE_KEY);
    if (!raw) return window.location.href="login.html";

    currentUser = JSON.parse(raw);
    if (!currentUser.email) return window.location.href="login.html";

    document.getElementById("user-display").textContent = currentUser.email;
}
requireLoginOrRedirect();

// ===== LOAD WORDS FROM SHEET =====
async function fetchWords() {
    const url = `${SHEET_WEB_APP_URL}?userEmail=${encodeURIComponent(currentUser.email)}`;
    const res = await fetch(url);
    const data = await res.json();

    words = data.words || [];
}

// ===== FOLDER FILTER UI =====
function renderFolders() {
    folderRow.innerHTML = "";

    const set = new Set();

    words.forEach(w => {
        if (w.folder) set.add(w.folder);
    });

    const folders = ["ALL", ...Array.from(set)];

    folders.forEach(f => {
        const btn = document.createElement("button");
        btn.className = "folder-pill" + (activeFolder === f ? " active" : "");
        btn.textContent = f === "ALL" ? "Tất cả" : f;

        btn.addEventListener("click", () => {
            activeFolder = f;
            renderFolders();
            showToast("Đã chọn folder: " + f);
        });

        folderRow.appendChild(btn);
    });
}

// ===== BUILD FLASHCARD SET =====
function buildFlashSet() {
    flashIndices = [];

    words.forEach((w, i) => {
        if (activeFolder !== "ALL" && w.folder !== activeFolder) return;
        flashIndices.push(i);
    });

    flashCurrent = 0;
    flashShowFront = true;
}

// ===== FLASHCARD RENDER =====
function renderFlashcard() {
    if (!flashIndices.length) {
        flashWordEl.textContent = "Không có từ nào";
        flashExtraEl.textContent = "Hãy chọn folder ở trên.";
        flashProgEl.textContent = "";
        return;
    }

    const idx = flashIndices[flashCurrent];
    const w = words[idx];

    if (flashShowFront) {
        flashWordEl.textContent = w.word;
        flashExtraEl.textContent = (w.ipa ? `/${w.ipa}/` : "") +
                                   (w.type ? ` • ${w.type}` : "");
    } else {
        flashWordEl.textContent = w.meaning;
        flashExtraEl.textContent = w.sentence ? `Ví dụ: ${w.sentence}` : "";
    }

    flashProgEl.textContent = `${flashCurrent + 1} / ${flashIndices.length}`;
}

// ===== EVENTS =====
flashStartBtn.addEventListener("click", () => {
    buildFlashSet();
    renderFlashcard();
    showToast("Bắt đầu ôn tập!", "success");
});

flipBtn.addEventListener("click", () => {
    if (!flashIndices.length) return;
    flashShowFront = !flashShowFront;
    renderFlashcard();
});

nextBtn.addEventListener("click", () => {
    if (!flashIndices.length) return;
    flashCurrent = (flashCurrent + 1) % flashIndices.length;
    flashShowFront = true;
    renderFlashcard();
});

prevBtn.addEventListener("click", () => {
    if (!flashIndices.length) return;
    flashCurrent = (flashCurrent - 1 + flashIndices.length) % flashIndices.length;
    flashShowFront = true;
    renderFlashcard();
});

// ===== INIT =====
(async function init(){
    await fetchWords();
    renderFolders();
    renderFlashcard();
})();
