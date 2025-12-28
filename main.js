// ===== CONFIG =====
const SHEET_WEB_APP_URL      = "https://script.google.com/macros/s/AKfycbwF4oukVU_5jSvTDq89Fv5wIVlgrdMiihyJeKdiR59P_DwSXVx78QphXcqZNiPYyCF-/exec"; // Web App VocabScript (/exec)
const LOGIN_API_URL          = "https://script.google.com/macros/s/AKfycby6IISpVGmgSipGIzB1sX1XDfQBn8AYCByLT5m9knc5kL6E9-xXdD1N12fxJkpXXyCp/exec"; // Web App LoginScript (/exec)
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
let activeFolder = null;      // null = chưa chọn folder
let currentFolderNames = []; 
let bulkData = []; // Biến chứa dữ liệu tạm thời

const PAGE_SIZE = 10;   // mỗi trang 10 từ
let currentPage = 1;

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
const folderFilterRow = document.getElementById("folder-filter-row");
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
const paginationEl   = document.getElementById("pagination");
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

async function syncAccountStatus() {
    if (!currentUser || !currentUser.email) return;

    try {
        const res = await fetch(LOGIN_API_URL, {
            method: "POST", mode: "cors",
            body: JSON.stringify({ action: "checkStatus", email: currentUser.email })
        });
        const data = await res.json();

        if (data.status === "success") {
            // 1. Cập nhật ngày tháng (Logic cũ)
            currentUser.expiryDate = data.expiryDate;
            currentUser.regDate    = data.regDate;

            // 2. CẬP NHẬT KEY (LOGIC MỚI QUAN TRỌNG)
            // Lấy key mới nhất từ Sheet
            const serverKey = data.geminiKey || ""; 
            
            // Nếu Key trên server khác Key dưới máy -> Cập nhật theo Server
            if (currentUser.geminiKey !== serverKey) {
                console.log("Phát hiện thay đổi Key từ Server. Đang đồng bộ...");
                currentUser.geminiKey = serverKey;
                
                // Nếu Server trả về rỗng (tức là Admin đã xóa key trong Sheet)
                // -> Xóa luôn trong localStorage để chặn dùng
                if (!serverKey) {
                    localStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
                } else {
                    localStorage.setItem(GEMINI_KEY_STORAGE_KEY, serverKey);
                }
            }

            // Lưu profile mới nhất
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(currentUser));

            // Cập nhật đèn trạng thái
            if (typeof checkAiReadiness === "function") {
                checkAiReadiness();
            }

            // Check gia hạn (như cũ)
            if (!isPaidExpired()) {
                showToast("🎉 Tài khoản VIP đang hoạt động!", "success");
                updateUserUI_Active();
                closePremiumPopup();
            }
        }
    } catch (err) { console.error("Sync error:", err); }
}
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

function updateUserUI_Active() {
    const userPill = document.getElementById("user-display");
    if (userPill) {
        userPill.style.background = ""; // Reset về mặc định
        userPill.style.color = "";
        userPill.style.border = "";
        // Xóa chữ (Hết hạn) nếu có
        userPill.textContent = userPill.textContent.replace(" (Hết hạn)", "");
    }
}

// Cập nhật giao diện lúc vào trang (init)
function updateUI_InitState() {
    if (isPaidExpired()) {
        if (isTrialActive()) {
            // Đang dùng thử
            showToast(`Chào bạn mới! Bạn còn ${getTrialRemainingTime()} dùng thử.`, "info");
        } else {
            // Hết sạch hạn
            showToast("Hết hạn dùng thử. Vui lòng gia hạn.", "error");
            updateUserUI_Expired();
        }
    }
}

if (logoutButton) {
    logoutButton.addEventListener("click", () => {
        localStorage.removeItem(USER_STORAGE_KEY);
        localStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
        window.location.href = "login.html";
    });
}

function openAccountModalMobile() {
    // Logic: Nếu trên mobile thì hiện modal thông tin user, hoặc logout
    // Đơn giản nhất là hỏi đăng xuất hoặc đổi mật khẩu
    if(confirm("Bạn muốn đăng xuất? (Nhấn OK để đăng xuất, Cancel để đóng)")) {
        localStorage.removeItem(USER_STORAGE_KEY);
        localStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
        window.location.href = "login.html";
    }
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
    // Kiểm tra đăng nhập (giữ nguyên)
    if (typeof currentUser === 'undefined' || !currentUser || !currentUser.email) {
        showToast("Chưa đăng nhập, không thể lưu từ.", "error");
        return Promise.reject("Chưa đăng nhập"); // Trả về lỗi để bên ngoài biết
    }

    const payload = {
        ...word,
        userEmail: currentUser.email.toLowerCase(),
        action: "add"
    };

    // Thêm return vào đây để bên ngoài chờ được (await)
    return fetch(SHEET_WEB_APP_URL, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(payload)
    })
    .then(res => res.json())
    .then(data => {
        if (data.status === "success" && data.rowIndex) {
            // Logic cập nhật rowIndex cho từ vừa thêm
            // Lưu ý: Logic này giả định từ mới nằm cuối mảng (words[length-1])
            // Nếu bạn dùng unshift (thêm lên đầu), cần sửa chỗ này. 
            // Tuy nhiên để an toàn cho hàm cũ, ta tạm giữ nguyên.
            const last = words[words.length - 1];
            if (last && last.word === word.word && last.rowIndex == null) {
                last.rowIndex = data.rowIndex;
            }
            // Không show toast ở đây nữa để tránh spam thông báo khi thêm hàng loạt
            // showToast("Đã lưu từ mới", "success"); 
            return data; // Trả về data
        } else {
            console.warn("Gửi (add) lỗi:", data);
            throw new Error(data.message || "Lỗi server");
        }
    })
    .catch(err => {
        console.error("POST add error:", err);
        throw err;
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

// ✅ Cập nhật: gom folder + tạo chip, có kèm số lượng từ
function updateFolderSuggestions() {
    if (!folderList) return;

    const set = new Set();
    words.forEach(w => {
        if (w.folder && w.folder.trim() !== "") {
            set.add(w.folder.trim());
        }
    });

    const folders = Array.from(set).sort((a, b) => a.localeCompare(b));
    currentFolderNames = folders;

    // datalist cho ô input Folder
    folderList.innerHTML = "";
    folders.forEach(f => {
        const opt = document.createElement("option");
        opt.value = f;
        folderList.appendChild(opt);
    });

    // chip filter
    renderFolderFilters();
}

// ✅ Cập nhật: chip có số lượng, click chip mới renderWords
function renderFolderFilters() {
    if (!folderFilterRow) return;

    folderFilterRow.innerHTML = "";

    // Helper: Lấy từ khóa tìm kiếm an toàn (tránh lỗi null)
    const getSearchTerm = () => {
        const el = document.getElementById("search-input");
        return el ? el.value : "";
    };

    // Tính toán số lượng cho từng folder
    const counts = {};
    let noFolderCount = 0;
    let totalCount = words.length;

    words.forEach(w => {
        const f = (w.folder || "").trim();
        if (!f) {
            noFolderCount++;
        } else {
            counts[f] = (counts[f] || 0) + 1;
        }
    });

    // --- Helper tạo nút ---
    const createBtn = (label, isActive, onClick) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = label;
        btn.className = "folder-pill" + (isActive ? " active" : "");
        btn.addEventListener("click", onClick);
        return btn;
    };

    // 1. Nút "Tất cả"
    const isAllActive = (activeFolder === "ALL" || activeFolder === null);
    folderFilterRow.appendChild(createBtn(`Tất cả (${totalCount})`, isAllActive, () => {
        activeFolder = "ALL";
        currentPage = 1; 
        renderFolderFilters(); 
        
        // SỬA LỖI TẠI ĐÂY: Dùng hàm getSearchTerm() thay vì searchInput.value
        renderWords(getSearchTerm());
    }));

    // 2. Nút "Chưa phân loại"
    if (noFolderCount > 0) {
        const isNoFolderActive = (activeFolder === "_NO_FOLDER_");
        folderFilterRow.appendChild(createBtn(`📂 Chưa phân loại (${noFolderCount})`, isNoFolderActive, () => {
            activeFolder = "_NO_FOLDER_";
            currentPage = 1;
            renderFolderFilters();
            
            // SỬA LỖI TẠI ĐÂY
            renderWords(getSearchTerm());
        }));
    }

    // 3. Các folder khác
    currentFolderNames.forEach(folderName => {
        const count = counts[folderName] || 0;
        const isActive = (activeFolder === folderName);
        folderFilterRow.appendChild(createBtn(`${folderName} (${count})`, isActive, () => {
            activeFolder = folderName;
            currentPage = 1;
            renderFolderFilters();
            
            // SỬA LỖI TẠI ĐÂY
            renderWords(getSearchTerm());
        }));
    });
}
function renderPagination(totalPages, totalItems) {
    if (!paginationEl) return;

    paginationEl.innerHTML = "";

    // Helper: Lấy từ khóa tìm kiếm an toàn
    const getSearchTerm = () => {
        const el = document.getElementById("search-input");
        return el ? el.value : "";
    };

    if (totalPages <= 1) {
        const info = document.createElement("span");
        info.className = "page-info";
        info.textContent = `Hiển thị toàn bộ ${totalItems} từ`;
        paginationEl.appendChild(info);
        return; 
    }

    // Thông tin trang
    const info = document.createElement("span");
    info.className = "page-info";
    info.textContent = `Trang ${currentPage}/${totalPages} – Tổng ${totalItems} từ`;
    paginationEl.appendChild(info);

    // Nút Previous (<)
    const prevBtn = document.createElement("button");
    prevBtn.type = "button";
    prevBtn.textContent = "‹";
    prevBtn.className = "page-btn";
    prevBtn.disabled = currentPage === 1;
    
    prevBtn.onclick = () => {
        if (currentPage > 1) {
            currentPage--;
            // SỬA LỖI TẠI ĐÂY: Gọi hàm lấy text an toàn
            renderWords(getSearchTerm());
            
            const listEl = document.getElementById("word-list");
            if(listEl) listEl.scrollIntoView({behavior: "smooth", block: "start"});
        }
    };
    paginationEl.appendChild(prevBtn);

    // Nút Next (>)
    const nextBtn = document.createElement("button");
    nextBtn.type = "button";
    nextBtn.textContent = "›";
    nextBtn.className = "page-btn";
    nextBtn.disabled = currentPage >= totalPages;
    
    nextBtn.onclick = () => {
        if (currentPage < totalPages) {
            currentPage++;
            // SỬA LỖI TẠI ĐÂY: Gọi hàm lấy text an toàn
            renderWords(getSearchTerm());
            
            const listEl = document.getElementById("word-list");
            if(listEl) listEl.scrollIntoView({behavior: "smooth", block: "start"});
        }
    };
    paginationEl.appendChild(nextBtn);
}

function renderUserStatus() {
    // Không còn dùng user-pill ở sidebar nữa, ta target vào các ID trong Profile Tab
    const nameEl = document.getElementById("user-display");
    const emailEl = document.getElementById("user-email-sub");
    const badgeEl = document.getElementById("account-status-badge");

    if (!currentUser) return;

    // 1. Tên và Email
    const displayName = currentUser.name || (currentUser.email ? currentUser.email.split('@')[0] : "User");
    if (nameEl) nameEl.textContent = displayName;
    if (emailEl) emailEl.textContent = currentUser.email || "";

    // 2. Trạng thái (VIP/Trial/Expired)
    let badgeHtml = "";
    if (!isPaidExpired()) {
        badgeHtml = `<span class="status-tag tag-active" style="font-size:12px; padding:4px 8px;">✨ Tài khoản VIP</span>`;
    } else if (isTrialActive()) {
        const left = getTrialRemainingTime();
        badgeHtml = `<span class="status-tag tag-trial" style="font-size:12px; padding:4px 8px;">⚡ Dùng thử: ${left}</span>`;
    } else {
        badgeHtml = `<span class="status-tag tag-expired" style="font-size:12px; padding:4px 8px;">⛔ Hết hạn</span>`;
    }

    if (badgeEl) badgeEl.innerHTML = badgeHtml;
}

function renderUserProfileData() {
    renderUserStatus(); // Cập nhật header

    // Cập nhật thống kê
    const streakEl = document.getElementById("streak-count-val");
    const totalEl = document.getElementById("total-words-val");

    if (totalEl) totalEl.textContent = words.length;
    
    if (streakEl) {
        const days = computeStreakDays(words);
        streakEl.textContent = days;
    }
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
    // 1. Cập nhật số đếm ở Tab Profile (Mới)
    const totalEl = document.getElementById("total-words-val");
    if (totalEl) totalEl.textContent = words.length;

    // 2. Cập nhật pill cũ (Nếu còn giữ html thì update, không thì thôi)
    const pill = document.getElementById("total-count-pill");
    if (pill) {
        const span = pill.querySelector("span:last-child");
        if (span) span.textContent = words.length + " từ";
    }
}

// streak
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

    const start = new Date(earliest.getFullYear(), earliest.getMonth(), earliest.getDate());
    const end   = new Date(today.getFullYear(),   today.getMonth(),   today.getDate());

    const diffMs   = end - start;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;

    return Math.max(diffDays, 1);
}

function updateStreak() {
    // Tính toán streak
    const days = computeStreakDays(words);
    
    // Cập nhật ở Sidebar Mới
    const sidebarStreakEl = document.getElementById("sidebar-streak-val");
    if (sidebarStreakEl) {
        sidebarStreakEl.textContent = days + " ngày";
    }

    // Cập nhật ở Profile Tab (nếu có)
    const profileStreakEl = document.getElementById("streak-count-val");
    if (profileStreakEl) {
        profileStreakEl.textContent = days;
    }
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

    // Helper: Chỉ gán giá trị nếu ô input đó TỒN TẠI trên giao diện
    const safeSet = (element, value) => {
        if (element) {
            element.value = value;
        }
    };

    // --- TRƯỜNG HỢP 1: THOÁT CHẾ ĐỘ SỬA (RESET FORM) ---
    if (index < 0) {
        if (wordSubmitButton) wordSubmitButton.textContent = "+ Thêm vào Danh Sách";
        if (cancelEditButton) cancelEditButton.style.display = "none";
        if (editHint)         editHint.style.display = "none";

        // Reset về rỗng
        safeSet(wordInput, "");
        safeSet(meaningInput, "");
        safeSet(folderInput, "");
        safeSet(ipaInput, "");
        safeSet(typeInput, "");
        safeSet(sentenceInput, "");
        
        // Dòng này sẽ không còn gây lỗi nếu bạn đã xóa ô status
        safeSet(statusSelect, "new"); 
        
        return;
    }

    // --- TRƯỜNG HỢP 2: BẬT CHẾ ĐỘ SỬA (ĐIỀN DỮ LIỆU) ---
    const w = words[index];
    if (!w) return;

    // Điền dữ liệu cũ vào các ô (nếu ô đó còn tồn tại)
    safeSet(wordInput, w.word || "");
    safeSet(meaningInput, w.meaning || "");
    safeSet(folderInput, w.folder || "");
    safeSet(ipaInput, w.ipa || "");
    safeSet(typeInput, w.type || "");
    safeSet(sentenceInput, w.sentence || "");
    safeSet(statusSelect, w.status || "new");

    // Đổi nút bấm thành "Lưu"
    if (wordSubmitButton) wordSubmitButton.textContent = "💾 Lưu thay đổi";
    if (cancelEditButton) cancelEditButton.style.display = "inline-flex";
    
    if (editHint) {
        editHint.style.display = "inline";
        editHint.textContent   = `Đang sửa từ: "${w.word}"`;
    }
}

function isRecentWord(dateString) {
    if (!dateString) return false;
    const addedDate = new Date(dateString);
    const now = new Date();
    
    // Tính khoảng cách thời gian (mili giây)
    const diffTime = now - addedDate;
    
    // Đổi ra ngày (1 ngày = 1000ms * 60s * 60m * 24h)
    const diffDays = diffTime / (1000 * 60 * 60 * 24);
    
    // Trả về true nếu nhỏ hơn hoặc bằng 3 ngày
    return diffDays <= 3;
}

// ✅ Render list có lọc folder + search, và ẩn khi chưa chọn folder
function renderWords(filterText = "") {
    // Xóa các dòng cũ (Giữ lại header ảo nếu có, nhưng CSS mobile đã ẩn header rồi)
    // Cách an toàn nhất: Xóa hết con trừ header (nếu bạn dùng giao diện PC cũ)
    // Hoặc xóa sạch và vẽ lại từ đầu nếu dùng giao diện Mobile Card toàn bộ.
    
    // Ở đây ta dùng logic: Giữ dòng đầu tiên (Header) nếu nó tồn tại
    const rows = Array.from(wordListEl.querySelectorAll(".word-row"));
    rows.forEach((row, index) => {
        if (row.classList.contains("word-header")) return; // Bỏ qua header
        row.remove();
    });

    if (activeFolder === null) activeFolder = "ALL";
    const text = (filterText || "").trim().toLowerCase();

    // 1. LỌC DỮ LIỆU
    let filtered = [];
    words.forEach((w, index) => {
        const f = (w.folder || "").trim();

        // Lọc Folder
        if (activeFolder !== "ALL") {
            if (activeFolder === "_NO_FOLDER_") {
                if (f !== "") return; 
            } else {
                if (f !== activeFolder) return;
            }
        }

        // Lọc Search
        if (text) {
            const match = (
                (w.word || "") + " " + (w.meaning || "") + " " + (w.folder || "")
            ).toLowerCase().includes(text);
            if (!match) return;
        }

        filtered.push({ w, index });
    });

    // 2. SẮP XẾP: ƯU TIÊN TỪ MỚI (3 NGÀY) LÊN ĐẦU
    filtered.sort((a, b) => {
        const isNewA = isRecentWord(a.w.dateAdded);
        const isNewB = isRecentWord(b.w.dateAdded);

        if (isNewA && !isNewB) return -1;
        if (!isNewA && isNewB) return 1;
        return 0; 
    });

    const totalItems = filtered.length;

    // Xử lý khi trống
    if (totalItems === 0) {
        wordEmptyEl.style.display = "block";
        if (activeFolder === "_NO_FOLDER_") {
            wordEmptyEl.textContent = "Bạn đã phân loại hết các từ rồi!";
        } else {
            wordEmptyEl.textContent = "Không có từ nào khớp với bộ lọc.";
        }
        if (paginationEl) paginationEl.innerHTML = "";
        return;
    } else {
        wordEmptyEl.style.display = "none";
    }

    // 3. PHÂN TRANG (Cắt mảng)
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
    
    // Bảo vệ: Nếu trang hiện tại lớn hơn tổng số trang (do lọc folder ít từ đi), reset về trang 1
    if (currentPage > totalPages) currentPage = 1;

    const start = (currentPage - 1) * PAGE_SIZE;
    const end   = start + PAGE_SIZE;
    const pageItems = filtered.slice(start, end);

    // 4. VẼ GIAO DIỆN (Loop)
    pageItems.forEach(({ w, index }) => {
        const row = document.createElement("div");
        row.className = "word-row";

        // Cột WORD + BADGE NEW
        const wordCell = document.createElement("div");
        let newBadgeHtml = "";
        if (isRecentWord(w.dateAdded)) {
            newBadgeHtml = `<span class="badge-new">NEW</span>`;
        }
        wordCell.innerHTML = `
            <span style="font-weight:600; color:#1f2937;">${w.word}</span>
            ${newBadgeHtml}
        `;

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

        // CỘT ACTIONS
        const actionsCell = document.createElement("div");
        actionsCell.className = "word-actions";

        const soundBtn = document.createElement("button");
        soundBtn.textContent = "🔊";
        soundBtn.className = "mini-btn voice";
        soundBtn.onclick = () => playPronunciation(w.word);

        const editBtn = document.createElement("button");
        editBtn.textContent = "Sửa";
        editBtn.className = "mini-btn edit";
        editBtn.onclick = () => { if(checkAccess()) setEditMode(index); };

        const delBtn = document.createElement("button");
        delBtn.textContent = "Xóa";
        delBtn.className = "mini-btn delete";
        
        // --- SỬA LẠI ĐOẠN ONCLICK NÀY ---
        delBtn.onclick = async () => {
            if(!checkAccess()) return;
            
            if(confirm(`Xóa từ "${w.word}"?`)) {
                try {
                    const data = await sendWordToGoogleSheet_Delete(index);
                    if(data && data.status === "success") {
                        // 1. Xóa khỏi mảng dữ liệu local
                        words.splice(index, 1);

                        // 2. FIX LỖI: Lấy từ khóa tìm kiếm an toàn
                        const searchEl = document.getElementById("search-input");
                        const currentTerm = searchEl ? searchEl.value : "";
                        
                        // 3. Vẽ lại danh sách với từ khóa hiện tại
                        renderWords(currentTerm);
                        
                        updateCount();
                        updateFolderSuggestions(); 
                        showToast("Đã xóa từ", "success");
                    } else {
                        showToast("Xóa thất bại", "error");
                    }
                } catch(e) { 
                    console.error(e); 
                    showToast("Lỗi kết nối", "error"); 
                }
            }
        };

        actionsCell.append(soundBtn, editBtn, delBtn);

        // Append vào hàng (Đã bỏ cột Status)
        row.append(wordCell, ipaCell, meaningCell, sentenceCell, typeCell, folderCell, actionsCell);
        
        wordListEl.appendChild(row);
    });

    // 5. GỌI HÀM VẼ PHÂN TRANG
    renderPagination(totalPages, totalItems);
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

        // 1. LẤY DỮ LIỆU AN TOÀN (Tránh lỗi null)
        const getVal = (el) => el ? el.value.trim() : "";
        
        const word     = getVal(wordInput);
        const meaning  = getVal(meaningInput);
        const folder   = getVal(folderInput);
        const ipa      = getVal(ipaInput);
        const type     = getVal(typeInput);
        const sentence = getVal(sentenceInput);

        // XỬ LÝ STATUS THÔNG MINH:
        // Nếu có ô chọn (statusSelect) thì lấy giá trị.
        // Nếu không có:
        //   - Đang thêm mới -> mặc định 'new'
        //   - Đang sửa -> giữ nguyên status cũ
        let status = "new";
        if (typeof statusSelect !== 'undefined' && statusSelect) {
            status = statusSelect.value;
        } else if (editingIndex >= 0 && words[editingIndex]) {
            status = words[editingIndex].status; // Giữ status cũ
        }

        if (!word || !meaning) {
            showToast("Vui lòng nhập từ và nghĩa", "error");
            return;
        }

        // ============================================================
        // 🔴 CHECK TRÙNG LẶP (Code của bạn đã được tối ưu)
        // ============================================================
        const inputLower = word.toLowerCase(); 

        const isDuplicate = words.some((w, index) => {
            // Nếu đang sửa, bỏ qua chính nó
            if (editingIndex >= 0 && index === editingIndex) return false;
            
            // So sánh
            return (w.word || "").toLowerCase() === inputLower;
        });

        if (isDuplicate) {
            showToast(`Từ "${word}" đã có trong danh sách!`, "error");
            
            // Hiệu ứng cảnh báo
            if(wordInput) {
                wordInput.focus();
                wordInput.style.borderColor = "#ef4444";
                wordInput.style.backgroundColor = "#fef2f2";
                setTimeout(() => {
                    wordInput.style.borderColor = "";
                    wordInput.style.backgroundColor = "";
                }, 2000);
            }
            return; // ⛔ DỪNG
        }
        // ============================================================

        // Tạo object từ mới
        const newWord = { word, meaning, folder, ipa, type, sentence, status };
        
        // Helper: Lấy từ khóa tìm kiếm an toàn
        const getCurrentSearch = () => {
            const el = document.getElementById("search-input");
            return el ? el.value : "";
        };

        // --- TRƯỜNG HỢP 1: THÊM MỚI ---
        if (editingIndex < 0) {
            const now = new Date();
            const localDate = now.toISOString().slice(0, 10); 

            // Cập nhật local
            words.push({
                rowIndex : null,
                ...newWord,
                dateAdded: localDate 
            });

            // Gửi Server
            sendWordToGoogleSheet_Add(newWord);

            // Cập nhật UI
            renderWords(getCurrentSearch());
            updateCount();
            updateStreak();
            updateFolderSuggestions();
            
            // Reset form
            setEditMode(-1); 
            showToast(`Đã thêm từ: ${word}`, "success");

        } 
        // --- TRƯỜNG HỢP 2: SỬA TỪ ---
        else {
            // Giữ lại ngày thêm cũ
            newWord.dateAdded = words[editingIndex].dateAdded;

            try {
                // Đổi nút bấm thành đang lưu
                if(wordSubmitButton) {
                    wordSubmitButton.textContent = "⏳ Đang lưu...";
                    wordSubmitButton.disabled = true;
                }

                const data = await sendWordToGoogleSheet_Update(editingIndex, newWord);
                
                if (data && data.status === "success") {
                    // Cập nhật local
                    words[editingIndex] = { ...words[editingIndex], ...newWord };
                    
                    renderWords(getCurrentSearch());
                    updateFolderSuggestions();
                    setEditMode(-1); // Thoát chế độ sửa
                    
                    showToast("Cập nhật thành công!", "success");
                } else {
                    showToast("Lỗi Server (không lưu được)", "error");
                }
            } catch (err) {
                console.error("Update error:", err);
                showToast("Lỗi kết nối mạng", "error");
            } finally {
                // Trả lại nút bấm (nếu setEditMode chưa reset)
                if(wordSubmitButton) {
                    wordSubmitButton.disabled = false;
                    if(editingIndex >= 0) wordSubmitButton.textContent = "💾 Lưu thay đổi";
                }
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
        if (!checkAccess()) return;
        await fetchWordsFromSheet();
        renderWords(searchInput.value);
        updateCount();
        updateStreak();
        updateFolderSuggestions();
        setEditMode(-1);
        showToast("Đã tải lại từ Danh Sách", "info");
    });
}

if (searchInput) {
    searchInput.addEventListener("input", e => {
        currentPage = 1;                  // reset về trang đầu
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
            await testGeminiKey(key);

            localStorage.setItem(GEMINI_KEY_STORAGE_KEY, key);

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
        // 1. Kiểm tra quyền hạn (VIP/Trial)
        if (!checkAccess()) return;
        
        const word = (wordInput.value || "").trim();
        if (!word) {
            alert("Hãy nhập từ vựng (Word) trước khi nhờ AI gợi ý.");
            return;
        }

        const originalBtnText = aiButton.textContent;
        
        // 2. CHECK ÂM THẦM (Chỉ disable nút để tránh spam click)
        aiButton.disabled = true;
        // aiButton.textContent = "Checking..."; // Không cần đổi text nếu muốn hoàn toàn âm thầm
        
        try {
            // Đồng bộ nhẹ với Server để đảm bảo Key chưa bị Admin xóa
            await syncAccountStatus(); 

            // Lấy key hiện tại
            const currentKey = currentUser ? currentUser.geminiKey : "";

            // --- TRƯỜNG HỢP 1: KHÔNG CÓ KEY (MỞ MODAL NGAY) ---
            if (!currentKey) {
                // Mở modal cấu hình để người dùng tự nhập và kiểm tra trong đó
                showApiKeyModal();
                return; // Dừng tại đây
            }

            // --- TRƯỜNG HỢP 2: CÓ KEY -> GỌI AI ---
            aiButton.textContent = "⏳ AI đang nghĩ...";
            openAiModal(word); 

            // Gọi hàm AI
            const aiData = await aiGenerateWordData(word);

            // Điền dữ liệu
            ipaInput.value      = aiData.ipa      || "";
            typeInput.value     = aiData.type     || "";
            meaningInput.value  = aiData.meaning  || "";
            sentenceInput.value = aiData.sentence || "";
            statusSelect.value  = aiData.status   || "new";

            showToast("AI đã gợi ý thành công!", "success");

        } catch (err) {
            console.error("AI Error:", err);
            
            // Nếu lỗi do Key sai/hết hạn (Google trả về 400/403) -> Cũng mở Modal cấu hình
            if (err.message === "NO_GEMINI_KEY" || err.message.includes("400") || err.message.includes("403")) {
                showToast("Key lỗi hoặc hết hạn. Vui lòng kiểm tra lại.", "error");
                showApiKeyModal();
            } else {
                showToast("Lỗi kết nối AI: " + err.message, "error");
            }
        } finally {
            // Dọn dẹp
            closeAiModal();
            aiButton.disabled = false;
            aiButton.textContent = originalBtnText;
        }
    });
}

// ==========================================
// REVIEW SYSTEM LOGIC (ĐỘC LẬP HOÀN TOÀN)
// ==========================================

let reviewList = [];       // Danh sách từ để ôn
let currentReviewIdx = 0;  // Vị trí hiện tại
let pendingMode = "";      // Lưu tạm chế độ đang chọn (flashcard/fill)

// 1. Điều hướng Tab
function showSection(sectionId) {
    // Ẩn tất cả section
    const sections = ['vocab', 'review', 'irregular', 'profile'];
    
    // Lưu ý: Trong HTML cũ bạn đặt ID section hơi lộn xộn (cái thì ID, cái thì class nth-of-type).
    // Tốt nhất bạn nên đặt ID rõ ràng cho từng section trong HTML:
    // vocab-section, review-section, irregular-section, profile-section
    
    // Tạm thời ẩn theo cách cũ + thêm profile
    const vocabSec = document.querySelector('section.card:nth-of-type(1)'); // Mục Thêm từ
    const listSec  = document.querySelector('section.card:nth-of-type(2)'); // Mục Danh sách
    const reviewSec = document.getElementById('review-section');
    const irrSec    = document.getElementById('irregular-section');
    const profileSec = document.getElementById('profile-section');

    if (vocabSec) vocabSec.style.display = 'none';
    if (listSec)  listSec.style.display  = 'none';
    if (reviewSec) reviewSec.style.display = 'none';
    if (irrSec)    irrSec.style.display    = 'none';
    if (profileSec) profileSec.style.display = 'none';

    // Xóa active class ở nav
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));

    // Hiện section được chọn
    if (sectionId === 'vocab') {
        if (vocabSec) vocabSec.style.display = 'block';
        if (listSec)  listSec.style.display  = 'block';
        // Active nút đầu tiên
        document.querySelector('.nav-item:nth-child(1)').classList.add('active');
    } 
    else if (sectionId === 'review') {
        if (reviewSec) reviewSec.style.display = 'block';
        backToReviewMenu();
        document.querySelector('.nav-item:nth-child(2)').classList.add('active');
    }
    else if (sectionId === 'irregular') {
        if (irrSec) irrSec.style.display = 'block';
        if (!isIrregularLoaded) fetchIrregularVerbsFromSheet(); 
        document.querySelector('.nav-item:nth-child(3)').classList.add('active');
    }
    else if (sectionId === 'profile') {
        if (profileSec) profileSec.style.display = 'block';
        // Active nút thứ 4
        document.querySelector('.nav-item:nth-child(4)').classList.add('active');
        
        // Render lại UI Profile mỗi khi vào đây để đảm bảo data mới nhất
        renderUserProfileData();
    }
}

// 2. Navigation trong Review
function backToReviewFolder() {
    // Ẩn 3 game
    const flashcardEl = document.getElementById('mode-flashcard');
    const fillEl      = document.getElementById('mode-fill');
    const scrambleEl  = document.getElementById('mode-scramble'); // <-- Bổ sung cái này

    if (flashcardEl) flashcardEl.style.display = 'none';
    if (fillEl)      fillEl.style.display = 'none';
    if (scrambleEl)  scrambleEl.style.display = 'none';

    // Hiện lại màn chọn folder
    document.getElementById('review-folder-selection').style.display = 'block';
}

// Quay lại Menu chính của phần Ôn tập
function backToReviewMenu() {
    const menuEl      = document.getElementById('review-menu');
    const folderSelEl = document.getElementById('review-folder-selection');
    
    // Ẩn hết game + màn chọn folder
    const flashcardEl = document.getElementById('mode-flashcard');
    const fillEl      = document.getElementById('mode-fill');
    const scrambleEl  = document.getElementById('mode-scramble'); // <-- Bổ sung

    if (folderSelEl) folderSelEl.style.display = 'none';
    if (flashcardEl) flashcardEl.style.display = 'none';
    if (fillEl)      fillEl.style.display = 'none';
    if (scrambleEl)  scrambleEl.style.display = 'none';

    // Hiện menu
    if (menuEl) menuEl.style.display = 'block';
}

// 3. Bước 1: Chọn Game -> Hiện màn hình chọn Folder
function startReviewSetup(mode) {
    
     if (!checkAccess()) return; // <--- Bấm vào tab Ôn tập là hiện Popup đòi tiền
    
    if (words.length === 0) {
        alert("Chưa có từ vựng nào để ôn tập!");
        return;
    }
    

    pendingMode = mode; 

    // Ẩn menu, hiện màn hình chọn folder
    document.getElementById('review-menu').style.display = 'none';
    document.getElementById('review-folder-selection').style.display = 'block';

    const selectEl = document.getElementById('review-folder-select');
    selectEl.innerHTML = "";

    // --- LOGIC MỚI: Đếm folder & từ chưa phân loại ---
    const folderCounts = {};
    let noFolderCount = 0; // Biến đếm từ không có folder

    words.forEach(w => {
        const f = (w.folder || "").trim();
        if (!f) {
            noFolderCount++; // Tăng đếm nếu không có folder
        } else {
            folderCounts[f] = (folderCounts[f] || 0) + 1;
        }
    });

    // Option 1: Tất cả
    const allOpt = document.createElement("option");
    allOpt.value = "ALL";
    allOpt.textContent = `Tất cả (${words.length} từ)`;
    selectEl.appendChild(allOpt);

    // Option 2: Chưa phân loại (Chỉ hiện nếu có từ)
    if (noFolderCount > 0) {
        const noFolderOpt = document.createElement("option");
        noFolderOpt.value = "_NO_FOLDER_"; // Giá trị đặc biệt để nhận biết
        noFolderOpt.textContent = `📂 Chưa phân loại (${noFolderCount} từ)`;
        noFolderOpt.style.fontStyle = "italic";
        selectEl.appendChild(noFolderOpt);
    }

    // Option 3: Các folder khác (Sắp xếp A-Z)
    Object.keys(folderCounts).sort().forEach(folderName => {
        const opt = document.createElement("option");
        opt.value = folderName;
        opt.textContent = `${folderName} (${folderCounts[folderName]} từ)`;
        selectEl.appendChild(opt);
    });
}

// 4. Bước 2: Bấm "Bắt đầu ngay" -> Vào Game
function confirmStartGame() {
    const selectEl = document.getElementById('review-folder-select');
    const selectedFolder = selectEl.value;

    reviewList = [];

    // --- LOGIC MỚI: Xử lý lọc danh sách ---
    if (selectedFolder === "ALL") {
        // Lấy hết
        reviewList = [...words];
    } 
    else if (selectedFolder === "_NO_FOLDER_") {
        // Lấy những từ folder rỗng
        reviewList = words.filter(w => !(w.folder || "").trim());
    } 
    else {
        // Lấy theo tên folder cụ thể
        reviewList = words.filter(w => (w.folder || "").trim() === selectedFolder);
    }

    if (reviewList.length === 0) {
        alert("Danh sách trống!");
        return;
    }

    // Xáo trộn danh sách
    reviewList.sort(() => Math.random() - 0.5);
    currentReviewIdx = 0;

    // Ẩn màn chọn folder -> Hiện game
    document.getElementById('review-folder-selection').style.display = 'none';

    if (pendingMode === 'flashcard') {
        document.getElementById('mode-flashcard').style.display = 'block';
        renderFlashcard();
    } else if (pendingMode === 'fill') {
        document.getElementById('mode-fill').style.display = 'block';
        renderFillQuestion();
    }
    else if (pendingMode === 'scramble') {
        document.getElementById('mode-scramble').style.display = 'block';
        renderScrambleGame();
    }
}
// 5. Logic Game: Flashcard
function renderFlashcard() {
    const w = reviewList[currentReviewIdx];
    const cardEl = document.getElementById('flashcard-el');
    
    // Reset về mặt trước
    cardEl.classList.remove('is-flipped');
    
    setTimeout(() => {
        document.getElementById('fc-word').textContent = w.word;
        document.getElementById('fc-ipa').textContent = w.ipa || "";
        document.getElementById('fc-meaning').textContent = w.meaning;
        document.getElementById('fc-sentence').textContent = w.sentence || "(Chưa có ví dụ)";
        document.getElementById('fc-progress').textContent = `${currentReviewIdx + 1} / ${reviewList.length}`;
    }, 200);
}

function flipCard() {
    const card = document.getElementById("flashcard-el");
    if (!card) return;

    // Lật thẻ bằng cách toggle class 'is-flipped'
    card.classList.toggle("is-flipped");

    // Kiểm tra nếu thẻ đang lật sang mặt sau (hoặc vừa ấn lật) thì phát âm
    // Ở đây chúng ta sẽ lấy từ đang hiển thị ở mặt trước để phát âm
    const wordText = document.getElementById("fc-word").textContent;
    
    if (wordText && wordText !== "Word") {
        playPronunciation(wordText);
    }
}

function nextFlashcard() {
    if (currentReviewIdx < reviewList.length - 1) {
        currentReviewIdx++;
        renderFlashcard();
    } else {
        // THAY ALERT CŨ BẰNG HÀM MỚI
        showCelebration(); 
    }
}

function prevFlashcard() {
    if (currentReviewIdx > 0) {
        currentReviewIdx--;
        renderFlashcard();
    }
}

// 6. Logic Game: Fill in blank
function renderFillQuestion() {
    const w = reviewList[currentReviewIdx];
    
    document.getElementById('fill-meaning').textContent = w.meaning;
    document.getElementById('fill-folder').textContent = w.folder || "Chung";
    
    const input = document.getElementById('fill-input');
    input.value = "";
    input.disabled = false;
    input.focus();
    
    const feedback = document.getElementById('fill-feedback');
    feedback.textContent = "";
    feedback.className = "feedback-msg";
}

function checkFillAnswer() {
    const w = reviewList[currentReviewIdx];
    const input = document.getElementById('fill-input');
    const userVal = input.value.trim().toLowerCase();
    const correctVal = w.word.trim().toLowerCase();
    const feedback = document.getElementById('fill-feedback');

    if (!userVal) return;

    if (userVal === correctVal) {
        feedback.textContent = "🎉 Chính xác! " + w.word;
        feedback.className = "feedback-msg correct";
        input.disabled = true;
        playPronunciation(w.word); 
    } else {
        feedback.textContent = `Sai rồi. Đáp án đúng: ${w.word}`;
        feedback.className = "feedback-msg wrong";
    }
}

function nextFillQuestion() {
    if (currentReviewIdx < reviewList.length - 1) {
        currentReviewIdx++;
        renderFillQuestion();
    } else {
        // THAY ALERT CŨ BẰNG HÀM MỚI
        showCelebration();
    }
}

// Hỗ trợ nhấn Enter
const fillEl = document.getElementById('fill-input');
if (fillEl) {
    fillEl.addEventListener("keypress", function(event) {
        if (event.key === "Enter") {
            checkFillAnswer();
        }
    });
}

// ==========================================
// SCRAMBLE GAME LOGIC (SẮP XẾP CHỮ)
// ==========================================
let scrambleCurrentAnswer = []; // Mảng lưu các ký tự người dùng đã xếp
let scrambleOriginChars = [];   // Mảng lưu ký tự gốc (đã xáo trộn) để render Pool

function renderScrambleGame() {
    const w = reviewList[currentReviewIdx];
    document.getElementById('scramble-meaning').textContent = w.meaning;

    const feedback = document.getElementById('scramble-feedback');
    feedback.textContent = "";
    feedback.className = "feedback-msg";
    document.getElementById('scramble-answer-zone').className = "scramble-slots";

    // 1. Chuẩn bị từ vựng: Xóa khoảng trắng, đưa về chữ hoa
    const cleanWord = w.word.replace(/\s+/g, '').toUpperCase();
    
    // 2. Tạo mảng ký tự và xáo trộn
    // Mẹo: map về object có id để phân biệt các chữ cái giống nhau (vd: 2 chữ P trong APPLE)
    scrambleOriginChars = cleanWord.split('').map((char, index) => ({
        id: index,
        char: char
    }));
    
    // Xáo trộn (Shuffle)
    scrambleOriginChars.sort(() => Math.random() - 0.5);

    scrambleCurrentAnswer = []; // Reset câu trả lời
    renderScrambleUI();
}

function renderScrambleUI() {
    const poolEl = document.getElementById('scramble-pool');
    const answerEl = document.getElementById('scramble-answer-zone');
    
    poolEl.innerHTML = "";
    answerEl.innerHTML = "";

    // Render Pool (Các chữ cái bên dưới)
    scrambleOriginChars.forEach(item => {
        const btn = document.createElement("div");
        btn.className = "letter-tile";
        btn.textContent = item.char;
        
        // Kiểm tra xem ký tự này đã được chọn lên trên chưa
        const isSelected = scrambleCurrentAnswer.find(a => a.id === item.id);
        if (isSelected) {
            btn.classList.add("used"); // Ẩn đi nếu đã chọn
        } else {
            // Sự kiện: Bấm vào Pool -> Bay lên Answer
            btn.onclick = () => {
                scrambleCurrentAnswer.push(item);
                renderScrambleUI(); // Vẽ lại
            };
        }
        poolEl.appendChild(btn);
    });

    // Render Answer Zone (Các chữ cái đã chọn)
    scrambleCurrentAnswer.forEach((item, index) => {
        const btn = document.createElement("div");
        btn.className = "letter-tile";
        btn.textContent = item.char;
        
        // Sự kiện: Bấm vào Answer -> Trả về Pool
        btn.onclick = () => {
            scrambleCurrentAnswer.splice(index, 1); // Xóa khỏi answer
            renderScrambleUI(); // Vẽ lại
        };
        answerEl.appendChild(btn);
    });
}

function resetScramble() {
    scrambleCurrentAnswer = [];
    renderScrambleUI();
    document.getElementById('scramble-feedback').textContent = "";
    document.getElementById('scramble-answer-zone').className = "scramble-slots";
}

function checkScrambleAnswer() {
    const w = reviewList[currentReviewIdx];
    const cleanWord = w.word.replace(/\s+/g, '').toUpperCase();
    
    // Ghép các ký tự user chọn thành chuỗi
    const userAnswer = scrambleCurrentAnswer.map(i => i.char).join('');
    const feedback = document.getElementById('scramble-feedback');
    const zone = document.getElementById('scramble-answer-zone');

    if (userAnswer === cleanWord) {
        feedback.textContent = "🎉 Chính xác! " + w.word;
        feedback.className = "feedback-msg correct";
        zone.classList.add("correct");
        playPronunciation(w.word);
    } else {
        feedback.textContent = "Sai rồi, thử lại nhé!";
        feedback.className = "feedback-msg wrong";
        zone.classList.add("wrong");
        // Hiệu ứng rung nhẹ nếu muốn (optional)
        setTimeout(() => zone.classList.remove("wrong"), 500);
    }
}

function nextScrambleQuestion() {
    if (currentReviewIdx < reviewList.length - 1) {
        currentReviewIdx++;
        renderScrambleGame();
    } else {
        showCelebration(); // Gọi hiệu ứng pháo giấy chiến thắng
    }
}

// ==========================================
// LOGIC DÙNG THỬ 24H & CHECK QUYỀN
// ==========================================

function isPaidExpired() {
    if (!currentUser) return true;
    const expiryStr = currentUser.expiryDate; // Lấy từ cột B
    
    // Nếu không có ngày hạn -> Coi như chưa kích hoạt -> HẾT HẠN
    if (!expiryStr || expiryStr.trim() === "") return true;

    try {
        const expiryDate = new Date(expiryStr);
        // Nếu định dạng ngày sai -> Coi như hết hạn để an toàn
        if (isNaN(expiryDate.getTime())) return true;

        const now = new Date();
        // Cho phép dùng đến giây cuối cùng của ngày hết hạn
        expiryDate.setHours(23, 59, 59, 999);
        
        return now > expiryDate;
    } catch (e) {
        return true;
    }
}

function openPremiumModal() {
    const modal = document.getElementById("premium-modal");
    const dateEl = document.getElementById("session-expired-date");
    const titleEl = document.querySelector(".premium-title"); // Tiêu đề modal

    if (!modal || !dateEl) return;

    const rawDate = currentUser ? (currentUser.expiryDate || "") : "";

    // --- LOGIC HIỂN THỊ ---
    
    if (!rawDate || rawDate.trim() === "") {
        // TRƯỜNG HỢP 1: Cột B trống (Chưa từng gia hạn)
        dateEl.textContent = "Chưa gia hạn";
        dateEl.style.color = "#d97706"; // Màu vàng cam
        if(titleEl) titleEl.textContent = "Kích hoạt tài khoản"; // Đổi tiêu đề cho hợp lý
        
    } else {
        // TRƯỜNG HỢP 2: Đã có ngày (nhưng đã quá hạn)
        try {
            const dateObj = new Date(rawDate);
            // Format ngày: 29/12/2025
            dateEl.textContent = dateObj.toLocaleDateString('vi-VN'); 
        } catch (e) {
            dateEl.textContent = rawDate; // Fallback nếu lỗi format
        }
        
        dateEl.style.color = "#b91c1c"; // Màu đỏ cảnh báo
        if(titleEl) titleEl.textContent = "Tài khoản hết hạn";
    }

    // Hiện Modal
    modal.style.display = "flex";

    const logoutBtn = document.getElementById("force-logout-btn");

    logoutBtn.addEventListener("click", () => {
        localStorage.removeItem(USER_STORAGE_KEY);
        localStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
        window.location.href = "login.html";
    });
}

// Hàm kiểm tra xem có còn trong thời gian DÙNG THỬ (24h) không
function isTrialActive() {
    if (!currentUser || !currentUser.regDate) return false;

    const regDate = new Date(currentUser.regDate);
    const now = new Date();
    
    // Tính thời điểm hết hạn dùng thử (Ngày đăng ký + 24 giờ)
    const trialEndTime = new Date(regDate.getTime() + (24 * 60 * 60 * 1000));
    
    // Nếu hiện tại vẫn nhỏ hơn thời điểm hết trial -> Còn dùng được
    return now < trialEndTime;
}

// Hàm tính thời gian còn lại (để hiển thị cho user sướng)
function getTrialRemainingTime() {
    if (!currentUser.regDate) return "";
    const regDate = new Date(currentUser.regDate);
    const trialEndTime = new Date(regDate.getTime() + (24 * 60 * 60 * 1000));
    const now = new Date();
    
    const diffMs = trialEndTime - now;
    if (diffMs <= 0) return "0 giờ";
    
    const hours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours} giờ ${minutes} phút`;
}

function isExpired() {
    if (!currentUser) return true;
    const expiryStr = currentUser.expiryDate;
    
    // Nếu không có ngày hạn => Coi như hết hạn
    if (!expiryStr || expiryStr.trim() === "") return true;

    const expiryDate = new Date(expiryStr);
    const now = new Date();
    expiryDate.setHours(23, 59, 59, 999); 
    
    return now > expiryDate;
}

// Hàm hiển thị Popup bán hàng
function showPremiumPopup() {
    const modal = document.getElementById("premium-modal");
    if (modal) modal.style.display = "flex";
}

// Hàm đóng Popup
function closePremiumPopup() {
    const modal = document.getElementById("premium-modal");
    if (modal) modal.style.display = "none";
}

// Hàm Wrapper: Kiểm tra quyền trước khi thực hiện hành động
function checkAccess() {
    if (!isPaidExpired()) {
        return true; 
    }

    // 2. Nếu không, kiểm tra gói Dùng thử
    if (isTrialActive()) {
        const remaining = getTrialRemainingTime();
        // Hiện thông báo nhẹ mỗi lần dùng để nhắc khéo
        showToast(`⚡ Dùng thử miễn phí: Còn ${remaining}`, "warning");
        return true; // Cho qua
    }

    // 3. Hết cả trả phí lẫn dùng thử -> CHẶN
    openPremiumModal();
    showPremiumPopup();
    return false;
}

// Hàm phụ trợ logout nhanh
function forceLogout(msg) {
    alert(msg);
    localStorage.removeItem(USER_STORAGE_KEY);
    localStorage.removeItem(GEMINI_KEY_STORAGE_KEY);
    window.location.href = "login.html";
}

// ==========================================
// HIỆU ỨNG CHIẾN THẮNG (CONFETTI)
// ==========================================

function showCelebration() {
    // 1. Phát nhạc (nếu trình duyệt cho phép) - Tuỳ chọn
    // const audio = new Audio('path/to/success.mp3'); audio.play().catch(()=>{});

    // 2. Hiện Modal
    const modal = document.getElementById("celebration-modal");
    const countEl = document.getElementById("celebration-count");
    
    if (countEl) countEl.textContent = reviewList.length;
    
    if (modal) {
        modal.style.display = "flex";
        modal.classList.add("show");
    }

    // 3. Bắn pháo giấy
    fireConfetti();
}

function closeCelebration() {
    const modal = document.getElementById("celebration-modal");
    if (modal) {
        modal.style.display = "none";
        modal.classList.remove("show");
    }
    // Quay về menu chọn folder
    backToReviewFolder();
}

// --- Logic vẽ Confetti (Gọn nhẹ, không cần thư viện ngoài) ---
function fireConfetti() {
    const canvas = document.getElementById("confetti-canvas");
    if (!canvas) return;
    
    canvas.style.display = "block";
    const ctx = canvas.getContext("2d");
    let W = window.innerWidth;
    let H = window.innerHeight;
    canvas.width = W;
    canvas.height = H;

    const mp = 150; // Số lượng hạt
    const particles = [];
    for (let i = 0; i < mp; i++) {
        particles.push({
            x: Math.random() * W,
            y: Math.random() * H - H,
            r: Math.random() * 12 + 4, // Bán kính
            d: Math.random() * mp,     // Mật độ
            color: `hsl(${Math.random() * 360}, 100%, 50%)`,
            tilt: Math.floor(Math.random() * 10) - 10,
            tiltAngle: 0,
            tiltAngleIncremental: Math.random() * 0.07 + 0.05
        });
    }

    let angle = 0;
    let animationId;

    function draw() {
        ctx.clearRect(0, 0, W, H);
        particles.forEach((p, i) => {
            angle += 0.01;
            p.tiltAngle += p.tiltAngleIncremental;
            p.y += (Math.cos(angle + p.d) + 3 + p.r / 2) / 2;
            p.x += Math.sin(angle);
            p.tilt = Math.sin(p.tiltAngle) * 15;

            ctx.beginPath();
            ctx.lineWidth = p.r / 2;
            ctx.strokeStyle = p.color;
            ctx.moveTo(p.x + p.tilt + p.r / 4, p.y);
            ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r / 4);
            ctx.stroke();

            // Nếu hạt rơi hết -> reset lại lên trên (tạo hiệu ứng mưa)
            // Hoặc muốn dừng thì check condition
            if (p.y > H) {
                 // Để tạo hiệu ứng "nổ" 1 lần rồi thôi, ta cho nó rơi ra khỏi màn hình rồi ẩn
                 // Nếu muốn lặp lại vô tận thì uncomment dòng dưới:
                 // p.x = Math.random() * W; p.y = -10;
                 particles.splice(i, 1);
            }
        });

        if (particles.length > 0) {
            animationId = requestAnimationFrame(draw);
        } else {
            canvas.style.display = "none";
            cancelAnimationFrame(animationId);
        }
    }
    
    draw();
}

// ==========================================
// IRREGULAR VERBS LOGIC (FROM SHEET)
// ==========================================

let cachedIrregularData = []; // Biến lưu data tải từ Sheet
let isIrregularLoaded = false; // Cờ đánh dấu đã tải chưa

// Hàm hiển thị Toast Loading (Góc trái)
function showLoadingToast(show, text = "Đang xử lý...") {
    const toast = document.getElementById("toast-loading");
    const textEl = document.getElementById("toast-loading-text");
    
    if (!toast) return;

    if (show) {
        if (textEl) textEl.textContent = text;
        toast.style.display = "flex"; // Đảm bảo flex để căn chỉnh
        // Cho một chút delay để transition hoạt động
        setTimeout(() => toast.classList.add("show"), 10);
    } else {
        toast.classList.remove("show");
        // Đợi transition xong mới ẩn hẳn
        setTimeout(() => {
            if (!toast.classList.contains("show")) {
                toast.style.display = "none";
            }
        }, 300);
    }
}
// CẬP NHẬT HÀM FETCH BQT
async function fetchIrregularVerbsFromSheet() {
    if (isIrregularLoaded) return; 

    // HIỆN TOAST LOADING
    showLoadingToast(true, "Đang tải 360 động từ BQT...");

    try {
        const res = await fetch(LOGIN_API_URL, {
            method: "POST",
            mode: "cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" },
            body: JSON.stringify({ action: "getIrregularVerbs" })
        });
        
        const data = await res.json();
        
        if (data.status === "success" && Array.isArray(data.data)) {
            cachedIrregularData = data.data;
            isIrregularLoaded = true;
            
            // Tải xong -> Đổi text thành "Hoàn tất" rồi ẩn sau 1.5s
            const textEl = document.getElementById("toast-loading-text");
            const spinner = document.querySelector("#toast-loading .mini-spinner");
            
            if (textEl) textEl.textContent = "Đã tải xong dữ liệu!";
            if (spinner) spinner.style.borderTopColor = "#10b981"; // Đổi màu xanh lá
            
            setTimeout(() => showLoadingToast(false), 1500);
            
        } else {
            console.warn("Không lấy được dữ liệu BQT");
            showLoadingToast(false);
        }
    } catch (err) {
        console.error("Lỗi fetch BQT:", err);
        showLoadingToast(false);
    }
}

// Hàm thực hiện tìm kiếm và Render
function triggerSearchIrregular() {
    const input = document.getElementById("irregular-search-input");
    const container = document.getElementById("irregular-result-container");
    const placeholder = document.getElementById("irregular-placeholder");
    
    const keyword = (input.value || "").trim().toLowerCase();

    // Reset giao diện
    container.innerHTML = "";
    container.style.display = "none";
    placeholder.style.display = "block";

    if (!keyword) return;

    // Lọc dữ liệu
    // Tìm chính xác hoặc gần đúng
    const results = cachedIrregularData.filter(item => {
        return (item.v1 || "").toLowerCase() === keyword ||
               (item.v2 || "").toLowerCase() === keyword ||
               (item.v3 || "").toLowerCase() === keyword ||
               (item.mean || "").toLowerCase().includes(keyword); // Nghĩa thì tìm gần đúng
    });

    if (results.length > 0) {
        placeholder.style.display = "none";
        container.style.display = "block";
        
        // Render từng kết quả tìm được
        results.forEach(item => {
            const card = document.createElement("div");
            card.className = "verb-detail-card";
            
            card.innerHTML = `
                <div class="verb-meaning">${item.mean}</div>
                <div class="verb-forms-row">
                    <div class="verb-col">
                        <span class="verb-label">Nguyên thể (V1)</span>
                        <div class="verb-word v1-style">${item.v1}</div>
                    </div>
                    <div class="verb-col">
                        <span class="verb-label">Quá khứ (V2)</span>
                        <div class="verb-word v2-style">${item.v2}</div>
                    </div>
                    <div class="verb-col">
                        <span class="verb-label">Phân từ II (V3)</span>
                        <div class="verb-word v3-style">${item.v3}</div>
                    </div>
                </div>
            `;
            container.appendChild(card);
        });
    } else {
        // Không tìm thấy
        placeholder.style.display = "block";
        placeholder.innerHTML = `<div style="font-size:30px">🤷‍♂️</div><div>Không tìm thấy từ "<b>${input.value}</b>" trong dữ liệu.</div>`;
    }
}

// Lắng nghe sự kiện gõ phím (Realtime search hoặc Enter)
const irrInput = document.getElementById("irregular-search-input");
if (irrInput) {
    irrInput.addEventListener("keyup", (e) => {
        // Tự động tìm sau khi gõ (hoặc check e.key === 'Enter' nếu muốn phải Enter mới tìm)
        triggerSearchIrregular();
    });
}


// Biến lưu trạng thái để tránh báo lặp lại liên tục
let hasNotifiedExpiration = false;

// Hàm chạy ngầm: Tự động kiểm tra hạn mỗi 60 giây
function startExpirationLoop() {
    // Chạy ngay lập tức 1 lần khi gọi
    checkAndNotify();

    // Sau đó lặp lại mỗi 60s
    setInterval(() => {
        checkAndNotify();
    }, 60000); 
}

function checkAndNotify() {
    // Nếu hết hạn VÀ chưa thông báo lần nào trong phiên này
    if (isExpired()) {
        if (!hasNotifiedExpiration) {
            // 1. Hiện thông báo Toast
            showToast("Tài khoản đã hết hạn. Chuyển sang chế độ CHỈ XEM.", "error");
            
            // 2. Cập nhật giao diện (Thêm nhãn "Hết hạn" cạnh tên user hoặc logo)
            updateUserUI_Expired();
            
            // Đánh dấu là đã báo rồi để ko spam toast mỗi phút
            hasNotifiedExpiration = true; 
        }
    }
}

let expirationInterval = null;

// Hàm khởi chạy vòng lặp kiểm tra (Gọi trong init)
function startRealtimeLoop() {
    // Chạy ngay lập tức để render UI
    checkAndRenderStatus();

    // Sau đó lặp lại mỗi 1 giây (1000ms) để đếm ngược mượt mà
    if (expirationInterval) clearInterval(expirationInterval);
    expirationInterval = setInterval(() => {
        checkAndRenderStatus();
    }, 1000); 
}

// Hàm xử lý trung tâm: Kiểm tra quyền + Cập nhật đồng hồ
function checkAndRenderStatus() {
    const timerBadge = document.getElementById("trial-timer-badge");
    const countdownEl = document.getElementById("trial-countdown");

    // 1. Nếu là VIP (Đã trả phí) -> Ẩn huy hiệu
    if (!isPaidExpired()) {
        if (timerBadge) timerBadge.style.display = "none";
        renderUserStatus(); 
        return;
    }

    // 2. Nếu chưa trả phí
    if (isTrialActive()) {
        // --- CÒN DÙNG THỬ ---
        if (timerBadge) {
            timerBadge.style.display = "block";
            timerBadge.classList.remove("expired");
            
            // Tính giờ
            const regDate = new Date(currentUser.regDate);
            const trialEndTime = new Date(regDate.getTime() + (24 * 60 * 60 * 1000));
            const now = new Date();
            const diffMs = trialEndTime - now;

            const hours = Math.floor(diffMs / (1000 * 60 * 60));
            const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diffMs % (1000 * 60)) / 1000);

            // Format số đẹp (01:05:09)
            const hStr = hours.toString().padStart(2, '0');
            const mStr = minutes.toString().padStart(2, '0');
            const sStr = seconds.toString().padStart(2, '0');

            if (countdownEl) {
                countdownEl.textContent = `${hStr}:${mStr}:${sStr}`;
            }

            const label = timerBadge.querySelector('.timer-label');
            const sub = timerBadge.querySelector('.timer-sub');
            if (label) label.textContent = "⚡ DÙNG THỬ MIỄN PHÍ";
            if (sub) sub.textContent = "Gia hạn để dùng vĩnh viễn";
        }
    } else {
        // --- HẾT HẠN ---
        if (timerBadge) {
            timerBadge.style.display = "block";
            timerBadge.classList.add("expired"); // Đổi màu đỏ
            
            // Sửa nội dung báo hết hạn
            if (countdownEl) countdownEl.textContent = "00:00:00";
            
            const label = timerBadge.querySelector('.timer-label');
            const sub = timerBadge.querySelector('.timer-sub');
            if (label) label.textContent = "⛔ ĐÃ HẾT HẠN";
            if (sub) sub.textContent = "Vui lòng gia hạn ngay";
        }
        updateUserUI_Expired();
    }

    renderUserStatus();
}

// Hàm cập nhật giao diện khi biết là hết hạn
function updateUserUI_Expired() {
    const userPill = document.getElementById("user-display");
    if (userPill) {
        userPill.style.background = "#fee2e2"; 
        userPill.style.color = "#b91c1c";
        userPill.style.border = "1px solid #ef4444";
        // Chỉ thêm chữ nếu chưa có
        if (!userPill.textContent.includes("Hết hạn")) {
             // Giữ lại tên, chỉ thêm status
             // userPill.textContent += " (Hết hạn)"; <-- Cách này dễ bị spam text
             // Nên render lại sạch sẽ:
             userPill.innerHTML = `👤 ${currentUser.name || currentUser.email} <small>(Hết hạn)</small>`;
        }
    }
}

// ==========================================
// CẬP NHẬT: MỞ MODAL & TỰ ĐỘNG CHECK KEY
// ==========================================

async function showApiKeyModal() {
    console.log("--- Bắt đầu mở Modal & Check Key ---");
    
    const modal = document.getElementById("api-key-modal");
    const input = document.getElementById("input-gemini-key");
    const msg = document.getElementById("api-msg");
    const saveBtn = document.querySelector("#api-key-modal .btn-primary");

    if (modal) {
        modal.style.display = "flex";

        // 1. HIỆN TRẠNG THÁI LOADING (Rõ ràng hơn)
        if (msg) {
            msg.innerHTML = `
                <div style="display:flex; align-items:center; gap:8px; color:#6b7280;">
                    <div class="mini-spinner" style="border-top-color:#6b7280;"></div> 
                    <span>Đang đồng bộ trạng thái với Server...</span>
                </div>
            `;
            msg.className = "modal-message";
        }
        
        // Khóa input trong lúc check
        if (input) {
            input.value = "Đang tải..."; // Xóa text cũ để người dùng biết đang load
            input.disabled = true; 
            input.style.backgroundColor = "#f3f4f6";
        }
        if (saveBtn) saveBtn.disabled = true;

        // 2. GỌI ĐỒNG BỘ SERVER
        // Thêm delay 500ms để người dùng kịp nhìn thấy hiệu ứng (UX tốt hơn)
        await new Promise(r => setTimeout(r, 500)); 
        await syncAccountStatus(); 

        console.log("--- Đồng bộ xong. Key hiện tại:", currentUser ? currentUser.geminiKey : "Không có");

        // 3. LẤY KEY MỚI NHẤT
        const currentKey = currentUser ? currentUser.geminiKey : "";
        
        // 4. CẬP NHẬT GIAO DIỆN KẾT QUẢ
        if (input) {
            input.value = currentKey;
            input.disabled = false; 
            input.style.backgroundColor = "#ffffff";
            // Tự động focus để nhập nếu trống
            if(!currentKey) setTimeout(() => input.focus(), 100);
        }
        if (saveBtn) saveBtn.disabled = false;
        
        if (msg) {
            if (currentKey) {
                msg.textContent = "✅ Key hợp lệ và đang hoạt động.";
                msg.className = "modal-message success";
            } else {
                msg.textContent = "⚠️ Tài khoản chưa có API Key (hoặc đã bị xóa).";
                msg.className = "modal-message error";
            }
        }
    }
}

// 2. Đóng Modal
function closeApiKeyModal() {
    const modal = document.getElementById("api-key-modal");
    if (modal) modal.style.display = "none";
}

// 3. Toggle Hướng dẫn (Xổ xuống/Thu gọn)
function toggleApiGuide() {
    const content = document.getElementById("api-guide-content");
    const arrow = document.getElementById("guide-arrow");
    
    if (content.style.display === "none") {
        content.style.display = "block";
        arrow.textContent = "▼"; // Mũi tên xuống
    } else {
        content.style.display = "none";
        arrow.textContent = "▶"; // Mũi tên phải
    }
}

// 4. Toggle Ẩn/Hiện Key (Mắt thần)
function toggleKeyVisibility() {
    const input = document.getElementById("input-gemini-key");
    if (input.type === "password") {
        input.type = "text";
    } else {
        input.type = "password";
    }
}

// 5. Lưu Key
// ==========================================
// API KEY MANAGER (VALIDATE & SYNC)
// ==========================================

// 1. Hàm Lưu Key: (Test Key cũ -> Lưu Backend cũ -> Cập nhật UI)
async function saveApiKey() {
    const input = document.getElementById("input-gemini-key");
    const msg = document.getElementById("api-msg");
    const saveBtn = document.querySelector("#api-key-modal .btn-primary"); // Nút Lưu trong modal mới
    const newKey = input.value.trim();

    if (!newKey) {
        msg.textContent = "Vui lòng nhập API Key.";
        msg.className = "modal-message error";
        return;
    }

    // UI Loading
    if(saveBtn) {
        saveBtn.textContent = "⏳ Đang kiểm tra...";
        saveBtn.disabled = true;
    }
    msg.textContent = "Đang kết nối thử đến Gemini...";
    msg.className = "modal-message";

    try {
        // --- BƯỚC 1: GỌI HÀM CŨ ĐỂ TEST KEY (Validate) ---
        // Lưu ý: Hàm testGeminiKey của bạn đang throw Error nếu lỗi, nên ta dùng try/catch
        await testGeminiKey(newKey); 

        // Nếu qua được dòng trên nghĩa là Key ngon
        
        // --- BƯỚC 2: GỌI BACKEND CŨ ĐỂ LƯU (action: saveGeminiKey) ---
        msg.textContent = "Key hợp lệ! Đang lưu vào hệ thống...";
        msg.className = "modal-message success";

        const res = await fetch(LOGIN_API_URL, {
            method: "POST", 
            mode: "cors",
            headers: { "Content-Type": "text/plain;charset=utf-8" }, // Quan trọng cho Apps Script
            body: JSON.stringify({ 
                action: "saveGeminiKey", // Action cũ backend đã có
                email: currentUser.email,
                key: newKey              // Tên trường khớp với backend cũ
            })
        });
        
        // Apps Script đôi khi trả về text lỗi HTML nếu sai URL, cần check
        let data;
        if (res.ok) {
             data = await res.json();
        } else {
             throw new Error("Lỗi kết nối Server Apps Script");
        }

        if (data.status === "success") {
            // Cập nhật Client
            currentUser.geminiKey = newKey;
            
            // Lưu cache user profile
            localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(currentUser));
            localStorage.setItem(GEMINI_KEY_STORAGE_KEY, newKey);

            msg.textContent = "✅ Đã lưu thành công!";
            msg.className = "modal-message success";
            
            // Cập nhật đèn xanh ở sidebar
            checkAiReadiness(); 

            setTimeout(() => closeApiKeyModal(), 1500);
        } else {
            msg.textContent = "Lỗi lưu server: " + (data.message || "Unknown error");
            msg.className = "modal-message error";
        }

    } catch (err) {
        console.error(err);
        // Nếu testGeminiKey throw lỗi hoặc lỗi mạng
        let errStr = err.message || "Key không hoạt động";
        if (errStr.includes("HTTP")) errStr = "Key sai hoặc lỗi mạng.";
        
        msg.textContent = "❌ Lỗi: " + errStr;
        msg.className = "modal-message error";
    } finally {
        if(saveBtn) {
            saveBtn.textContent = "Lưu cài đặt";
            saveBtn.disabled = false;
        }
    }
}

// 2. Hàm hiển thị đèn trạng thái (Xanh/Đỏ) ở Sidebar
function checkAiReadiness() {
    const configBtn = document.getElementById("btn-config-ai");
    if (!configBtn) return;

    // Kiểm tra trong biến currentUser (đã được sync từ Sheet khi init)
    const hasKey = currentUser && currentUser.geminiKey && currentUser.geminiKey.length > 20;

    if (hasKey) {
        // Đèn xanh
        configBtn.innerHTML = `⚙️ Cấu hình AI <span style="color:#10b981; margin-left:auto; font-size:14px;">●</span>`;
        configBtn.title = "AI đã sẵn sàng";
    } else {
        // Đèn đỏ
        configBtn.innerHTML = `⚙️ Cấu hình AI <span style="color:#ef4444; margin-left:auto; font-size:14px;">●</span>`;
        configBtn.title = "Chưa có API Key";
    }
}

// ==========================================
// SPACED REPETITION SYSTEM (SRS)
// ==========================================

function checkAndShowSRSPopup() {
    // 1. Kiểm tra xem hôm nay đã hiện chưa
    const todayStr = new Date().toDateString(); // VD: "Tue Dec 24 2024"
    const lastCheck = localStorage.getItem("vocab_srs_last_date");

    if (lastCheck === todayStr) {
        console.log("Hôm nay đã nhắc nhở ôn tập rồi.");
        return; // Đã hiện hôm nay rồi thì thôi
    }

    // 2. Lọc các từ trong vòng 3 ngày (Sử dụng hàm isRecentWord đã làm ở bước trước)
    // Lưu ý: Đảm bảo words đã được load từ Sheet xong mới chạy hàm này
    const wordsToReview = words.filter(w => isRecentWord(w.dateAdded));

    if (wordsToReview.length === 0) {
        return; // Không có từ mới nào thì không làm phiền
    }

    // 3. Render danh sách vào Modal
    const container = document.getElementById("srs-list-container");
    if (!container) return;
    
    container.innerHTML = ""; // Reset

    wordsToReview.forEach(w => {
        const div = document.createElement("div");
        div.className = "srs-item";
        
        // Tính xem từ này học cách đây mấy ngày
        const diffTime = new Date() - new Date(w.dateAdded);
        const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
        const dayLabel = diffDays === 0 ? "Hôm nay" : `${diffDays} ngày trước`;

        div.innerHTML = `
            <div>
                <div class="srs-word">${w.word}</div>
                <div class="srs-meaning">${w.meaning}</div>
            </div>
            <div class="srs-date">${dayLabel}</div>
        `;
        container.appendChild(div);
    });

    // 4. Hiển thị Modal
    const modal = document.getElementById("srs-modal");
    if (modal) {
        modal.style.display = "flex";
        // Hiệu ứng nhẹ
        setTimeout(() => modal.classList.add("show"), 10);
    }

    // 5. Đánh dấu là đã hiện hôm nay
    localStorage.setItem("vocab_srs_last_date", todayStr);
}

function closeSRSModal() {
    const modal = document.getElementById("srs-modal");
    if (modal) {
        modal.style.display = "none";
        modal.classList.remove("show");
    }
}

// ==========================================
// LOADER & TIPS SYSTEM
// ==========================================
const LOADING_TIPS = [
    "Phương pháp Spaced Repetition giúp bạn nhớ từ vựng lâu gấp 10 lần.",
    "Đừng chỉ học từ đơn lẻ, hãy đặt nó vào một câu ví dụ cụ thể.",
    "Học 5 từ mỗi ngày đều đặn tốt hơn học 50 từ một lúc rồi bỏ cuộc.",
    "Sử dụng hình ảnh và âm thanh để kích thích não bộ ghi nhớ.",
    "Ôn tập lại từ vựng trước khi đi ngủ giúp não bộ lưu trữ tốt hơn.",
    "Hãy thử đặt câu với từ mới ngay khi bạn vừa học được.",
    "Kiên trì là chìa khóa. Streak không chỉ là con số, nó là thói quen.",
    "Dùng AI gợi ý để tìm các ngữ cảnh sử dụng từ tự nhiên nhất."
];

let tipInterval;
let progressValue = 0;

function startLoaderSystem() {
    const tipTextEl = document.getElementById("loader-tip-text");
    const progressBar = document.getElementById("loader-progress");
    
    // 1. Random Tip đầu tiên
    if (tipTextEl) {
        tipTextEl.textContent = LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)];
    }

    // 2. Chạy vòng lặp đổi Tip (Mỗi 2.5s)
    tipInterval = setInterval(() => {
        if (!tipTextEl) return;
        
        // Fade out
        tipTextEl.classList.add("fade-out");
        
        setTimeout(() => {
            // Đổi text
            const randomTip = LOADING_TIPS[Math.floor(Math.random() * LOADING_TIPS.length)];
            tipTextEl.textContent = randomTip;
            
            // Fade in
            tipTextEl.classList.remove("fade-out");
        }, 500); // Khớp với transition CSS
    }, 2500);

    // 3. Giả lập thanh Progress chạy từ từ đến 90% (để người dùng đỡ sốt ruột)
    // Nếu mạng nhanh thì nó sẽ nhảy vọt lên 100% khi xong.
    const fakeProgress = setInterval(() => {
        if (progressValue < 90) {
            progressValue += Math.random() * 5; // Tăng ngẫu nhiên
            if (progressBar) progressBar.style.width = Math.min(progressValue, 90) + "%";
        } else {
            clearInterval(fakeProgress);
        }
    }, 200);
}

function stopLoaderSystem() {
    const loader = document.getElementById("global-loader");
    const progressBar = document.getElementById("loader-progress");
    
    // Đẩy thanh progress lên 100%
    if (progressBar) progressBar.style.width = "100%";

    // Dừng đổi tip
    if (tipInterval) clearInterval(tipInterval);

    // Đợi xíu cho thanh progress chạy hết rồi mới ẩn
    setTimeout(() => {
        if (loader) {
            loader.classList.add("hidden");
            
            // Xóa khỏi DOM sau khi ẩn hẳn để nhẹ máy (Optional)
            setTimeout(() => {
                loader.style.display = "none";
            }, 500);
        }
    }, 500);
}

// ==========================================
// SEASONAL EFFECTS ENGINE
// ==========================================

const SEASONAL_CONFIG = [
    // Tháng (month): 1-12, Ngày (day): 1-31
    // duration: Số ngày hiển thị trước sự kiện (mặc định 7)
    
    { name: "Christmas",     month: 12, day: 25, icon: "❄️", duration: 7 }, // Tuyết rơi
    { name: "NewYear",       month: 1,  day: 1,  icon: "✨", duration: 3 }, // Pháo hoa/Lấp lánh
    { name: "Tet_2025",      month: 1,  day: 29, icon: "🌸", duration: 10 }, // Tết Âm 2025 (Cần cập nhật hàng năm)
    { name: "Valentine",     month: 2,  day: 14, icon: "❤️", duration: 3 }, // Tim bay
    { name: "Halloween",     month: 10, day: 31, icon: "🎃", duration: 5 }, // Bí ngô
    { name: "HungKings",     month: 4,  day: 6,  icon: "🇻🇳", duration: 1 }, // Giỗ tổ (10/3 Âm - Ví dụ năm 2025 là 6/4 Dương)
];

const PET_ASSETS = [
    { 
        src: "https://media.tenor.com/eXlIRe28PVgAAAAi/bubu-dudu-bubu.gif", 
        type: "walk", width: 60 
    },
    { 
        src: "https://media.tenor.com/rI_0O_9AJ5sAAAAj/nyan-cat-poptart-cat.gif", 
        type: "fly", width: 80 
    },
    { 
        src: "https://media.tenor.com/mlLioaWLTqYAAAAi/pikachu-running.gif", 
        type: "walk", width: 70 
    }
];

function initUnifiedEffects() {
    const today = new Date();
    const currentYear = today.getFullYear();

    // 1. Kiểm tra xem hôm nay có sự kiện gì không?
    const activeEvent = SEASONAL_CONFIG.find(event => {
        const eventDate = new Date(currentYear, event.month - 1, event.day);
        
        const startDate = new Date(eventDate);
        startDate.setDate(eventDate.getDate() - event.duration);

        const endDate = new Date(eventDate);
        endDate.setDate(eventDate.getDate() + 1);

        return today >= startDate && today < endDate;
    });

    // 2. PHÂN LUỒNG XỬ LÝ
    if (activeEvent) {
        // TRƯỜNG HỢP A: Có sự kiện -> Chạy hiệu ứng rơi
        console.log(`🎉 Mode Lễ Hội: ${activeEvent.name}`);
        startFallingEffect(activeEvent.icon);
    } else {
        // TRƯỜNG HỢP B: Ngày thường -> Chạy thú cưng
        console.log("🐈 Mode Ngày Thường: Thả thú cưng");
        startDailyPets();
    }
}

function startFallingEffect(iconChar) {
    // Tạo container
    let container = document.getElementById("seasonal-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "seasonal-container";
        container.className = "seasonal-container";
        document.body.appendChild(container);
    }

    // Hàm tạo 1 hạt rơi
    function createFlake() {
        const el = document.createElement("div");
        el.className = "falling-item";
        el.textContent = iconChar;
        
        // Random vị trí và kích thước
        const left = Math.random() * 100; // 0% - 100% chiều ngang
        const size = Math.random() * 20 + 10; // 10px - 30px
        const duration = Math.random() * 3 + 2; // Rơi trong 2s - 5s
        const delay = Math.random() * 2; // Delay ngẫu nhiên

        el.style.left = left + "%";
        el.style.fontSize = size + "px";
        el.style.animationDuration = duration + "s";
        el.style.animationDelay = delay + "s";

        container.appendChild(el);

        // Tự xóa sau khi rơi xong để nhẹ máy
        setTimeout(() => {
            el.remove();
        }, (duration + delay) * 1000);
    }

    // Bắn hạt liên tục (nhưng vừa phải để không lag)
    // Cứ 300ms tạo 1 hạt (tăng giảm số này để chỉnh mật độ)
    setInterval(createFlake, 300);
}

function startDailyPets() {
    const MIN_INTERVAL = 4000;  
    const MAX_INTERVAL = 10000; 
    const PET_SPEED = 50; // Tăng tốc độ lên chút (50px/s) cho mượt

    function spawnPet() {
        // 1. Tìm Popup đang mở
        const visibleModal = Array.from(document.querySelectorAll('.modal-backdrop')).find(el => {
            return window.getComputedStyle(el).display !== 'none';
        })?.querySelector('.modal-card');

        // 2. Xác định vùng đi (Zone)
        let zone = {
            top: 0, left: 0, width: window.innerWidth, height: window.innerHeight, isPopup: false
        };
        if (visibleModal) {
            const rect = visibleModal.getBoundingClientRect();
            zone = { top: rect.top, left: rect.left, width: rect.width, height: rect.height, isPopup: true };
        }

        // 3. Tạo thú cưng
        const petInfo = PET_ASSETS[Math.floor(Math.random() * PET_ASSETS.length)];
        const pet = document.createElement("img");
        pet.src = petInfo.src;
        pet.className = "screen-pet";
        
        // 🔴 SỬA KÍCH THƯỚC: To hơn hẳn (1.0 -> 1.3 lần)
        // Nếu ở popup thì to 1.0, màn hình chính thì 1.3
        const scaleFactor = zone.isPopup ? 1.0 : 1.1; 
        const baseSize = petInfo.width * scaleFactor;
        pet.style.width = baseSize + "px";
        
        document.body.appendChild(pet);

        // 4. Chọn cạnh ngẫu nhiên (0: Dưới, 1: Trên, 2: Trái, 3: Phải)
        const edge = Math.floor(Math.random() * 4);
        
        let startX, startY, endX, endY, rotation;
        let distance = 0;

        switch (edge) {
            case 0: // === CẠNH DƯỚI (Đi: Trái -> Phải) ===
                startX = zone.left - baseSize;
                startY = zone.top + zone.height - (zone.isPopup ? 5 : 0); 
                endX   = zone.left + zone.width;
                endY   = startY;
                
                // Mặt hướng sang Phải (Mặc định)
                rotation = "scaleX(1)"; 
                distance = zone.width + baseSize;
                break;

            case 1: // === CẠNH TRÊN (Đi: Phải -> Trái) ===
                startX = zone.left + zone.width;
                startY = zone.top - baseSize + (zone.isPopup ? 5 : 0);
                endX   = zone.left - baseSize;
                endY   = startY;
                
                // 🔴 SỬA LỖI LẬT NGƯỢC: 
                // Chỉ lật ngang (scaleX -1) để mặt hướng sang Trái.
                // Bỏ scaleY(-1) để không bị lộn đầu xuống đất.
                rotation = "scaleX(-1)"; 
                distance = zone.width + baseSize;
                break;

            case 2: // === CẠNH TRÁI (Đi: Trên -> Dưới) ===
                startX = zone.left - baseSize + (zone.isPopup ? 10 : 0);
                startY = zone.top - baseSize;
                endX   = startX;
                endY   = zone.top + zone.height;
                
                // Xoay 90 độ: Đầu cắm xuống đất
                rotation = "rotate(90deg)"; 
                distance = zone.height + baseSize;
                break;

            case 3: // === CẠNH PHẢI (Đi: Dưới -> Trên) ===
                startX = zone.left + zone.width - (zone.isPopup ? 10 : 0);
                startY = zone.top + zone.height;
                endX   = startX;
                endY   = zone.top - baseSize;
                
                // Xoay -90 độ: Đầu hướng lên trời
                rotation = "rotate(-90deg)"; 
                distance = zone.height + baseSize;
                break;
        }

        // 5. Chạy Animation
        pet.style.opacity = "1"; 
        
        // Thời gian = Quãng đường / Tốc độ
        const duration = (distance / PET_SPEED) * 1000; 

        const animation = pet.animate([
            { transform: `translate(${startX}px, ${startY}px) ${rotation}` },
            { transform: `translate(${endX}px, ${endY}px) ${rotation}` }
        ], {
            duration: duration,
            easing: "linear",
            fill: "forwards"
        });

        animation.onfinish = () => {
            pet.remove();
        };

        const nextTime = Math.floor(Math.random() * (MAX_INTERVAL - MIN_INTERVAL) + MIN_INTERVAL);
        setTimeout(spawnPet, nextTime);
    }

    spawnPet();
}

function openBulkModal() {
    const modal = document.getElementById("bulk-modal");
    if(modal) {
        modal.style.display = "flex";
        // Reset
        document.getElementById("json-paste-area").value = "";
        document.getElementById("json-status").textContent = "";
        document.getElementById("bulk-preview-area").style.display = "none";
        document.getElementById("btn-process-json").disabled = true;
        bulkData = [];
    }
}

function closeBulkModal() {
    document.getElementById("bulk-modal").style.display = "none";
}

function autoCheckJson() {
    const rawInput = document.getElementById("json-paste-area").value.trim();
    const statusEl = document.getElementById("json-status");
    const previewArea = document.getElementById("bulk-preview-area");
    const saveBtn = document.getElementById("btn-process-json");

    if (!rawInput) {
        statusEl.textContent = "";
        previewArea.style.display = "none";
        saveBtn.disabled = true;
        return;
    }

    try {
        let cleanJson = rawInput.replace(/```json/g, "").replace(/```/g, "");
        const firstBracket = cleanJson.indexOf('[');
        const lastBracket = cleanJson.lastIndexOf(']');
        
        if (firstBracket !== -1 && lastBracket !== -1) {
            cleanJson = cleanJson.substring(firstBracket, lastBracket + 1);
        }

        const data = JSON.parse(cleanJson);

        if (Array.isArray(data) && data.length > 0) {
            // JSON Hợp lệ -> Lưu vào biến và Vẽ ra
            bulkData = data;
            
            statusEl.style.color = "#16a34a";
            statusEl.textContent = `✅ Hợp lệ! Đã tải ${data.length} từ.`;
            
            // Hiện khu vực xem trước
            previewArea.style.display = "block";
            renderBulkPreview(); // Vẽ danh sách
            
            saveBtn.disabled = false;
        }

    } catch (e) {
        statusEl.style.color = "#ef4444";
        statusEl.textContent = "❌ Đang chờ JSON hợp lệ...";
        previewArea.style.display = "none";
        saveBtn.disabled = true;
    }
}

function renderBulkPreview(filterText = "") {
    const container = document.getElementById("bulk-list-container");
    const countEl = document.getElementById("preview-count");
    container.innerHTML = "";

    const keyword = filterText.toLowerCase().trim();
    let visibleCount = 0;

    bulkData.forEach((item, index) => {
        // Kiểm tra xem có khớp từ khóa tìm kiếm không
        const match = (item.word || "").toLowerCase().includes(keyword) || 
                      (item.meaning || "").toLowerCase().includes(keyword);
        
        if (!match) return; // Nếu không khớp thì ẩn

        visibleCount++;

        const div = document.createElement("div");
        div.className = "bulk-item-row";
        div.innerHTML = `
            <div class="bulk-word-col">${item.word}</div>
            <div class="bulk-ipa-col">${item.ipa || ""}</div>
            <div class="bulk-mean-col">${item.meaning}</div>
            <button class="btn-delete-mini" onclick="removeBulkItem(${index})" title="Xóa từ này">×</button>
        `;
        container.appendChild(div);
    });

    countEl.textContent = visibleCount;
}

// 3. HÀM LỌC (GẮN VÀO Ô INPUT)
function filterBulkPreview() {
    const txt = document.getElementById("bulk-search-input").value;
    renderBulkPreview(txt);
}


// 4. XÓA 1 TỪ KHỎI DANH SÁCH PREVIEW
function removeBulkItem(index) {
    bulkData.splice(index, 1); // Xóa khỏi mảng gốc
    
    // Vẽ lại (giữ nguyên từ khóa tìm kiếm đang nhập)
    const txt = document.getElementById("bulk-search-input").value;
    renderBulkPreview(txt);
    
    // Cập nhật trạng thái
    document.getElementById("json-status").textContent = `Đã xóa. Còn lại ${bulkData.length} từ.`;
    
    // Nếu xóa hết thì khóa nút lưu
    if (bulkData.length === 0) {
        document.getElementById("btn-process-json").disabled = true;
        document.getElementById("bulk-preview-area").style.display = "none";
    }
}


// 5. LƯU (SỬ DỤNG BIẾN bulkData ĐÃ ĐƯỢC LỌC/XÓA)
async function processAndSaveBulk() {
    const btn = document.getElementById("btn-process-json");
    if (!btn || btn.disabled) return;
    if (bulkData.length === 0) return;

    // --- (Phần code bên dưới giữ nguyên logic như bài trước) ---
    // Khóa nút
    const originalText = btn.textContent;
    btn.textContent = "⏳ Đang xử lý...";
    btn.disabled = true;

    let targetFolder = "";
    if (typeof activeFolder !== 'undefined' && activeFolder && activeFolder !== "ALL" && activeFolder !== "_NO_FOLDER_") {
        targetFolder = activeFolder;
    }

    let successCount = 0;
    let duplicateCount = 0;
    const total = bulkData.length;

    for (let i = 0; i < total; i++) {
        const item = bulkData[i];
        btn.textContent = `⏳ Lưu ${i + 1}/${total}...`;

        const wordText = (item.word || "").trim();
        if (!wordText) continue;

        // Check trùng
        const isDuplicate = words.some(w => (w.word || "").toLowerCase() === wordText.toLowerCase());
        if (isDuplicate) {
            duplicateCount++;
            continue;
        }

        const newWord = {
            word:      wordText,
            meaning:   item.meaning || "",
            ipa:       item.ipa || "",
            sentence:  item.sentence || "",
            type:      item.type || "",
            folder:    targetFolder,
            status:    "new",
            dateAdded: new Date().toISOString().slice(0, 10),
            rowIndex:  null
        };

        words.push(newWord); 
        // Render search main list
        const searchEl = document.getElementById("search-input");
        renderWords(searchEl ? searchEl.value : "");

        try {
            await sendWordToGoogleSheet_Add(newWord);
            successCount++;
        } catch (e) {
            console.error(e);
        }
    }

    btn.textContent = originalText;
    btn.disabled = false;
    closeBulkModal();
    updateCount();
    updateFolderSuggestions(); 
    
    let msg = `Đã thêm ${successCount} từ.`;
    if (duplicateCount > 0) msg += ` (Bỏ qua ${duplicateCount} trùng)`;
    showToast(msg, successCount > 0 ? "success" : "warning");
}

async function sendWordToGoogleSheet(wordDataInput = null) {
    let dataToSend = wordDataInput;

    // TRƯỜNG HỢP 1: Nếu không truyền dữ liệu vào (Tức là đang Thêm thủ công từ Form)
    // -> Tự đi lấy dữ liệu từ các ô Input trên giao diện
    if (!dataToSend) {
        const wordVal = document.getElementById("word").value.trim();
        const meaningVal = document.getElementById("meaning").value.trim();
        
        if (!wordVal || !meaningVal) return null; // Validate cơ bản

        // Lấy status (nếu có)
        const statusEl = document.getElementById("status");
        
        dataToSend = {
            word: wordVal,
            meaning: meaningVal,
            folder: document.getElementById("folder").value.trim(),
            ipa: document.getElementById("ipa").value.trim(),
            type: document.getElementById("type").value.trim(),
            sentence: document.getElementById("sentence").value.trim(),
            status: statusEl ? statusEl.value : "new",
            dateAdded: new Date().toISOString().slice(0, 10) // yyyy-mm-dd
        };
    }

    // TRƯỜNG HỢP 2: Nếu có dữ liệu truyền vào (Bulk Add), thì dùng luôn dataToSend đó.

    // --- GỬI ĐI (Logic Fetch cũ của bạn) ---
    // (Thay SCRIPT_URL bằng biến URL của bạn nếu cần)

    // Tạo params
    const params = new URLSearchParams();
    params.append("action", "add");
    params.append("data", JSON.stringify(dataToSend));

    try {
        const response = await fetch(SHEET_WEB_APP_URL, {
            method: "POST",
            body: params,
            // mode: "no-cors" // CẢNH BÁO: Nếu bạn dùng no-cors bạn sẽ không nhận được json trả về. 
            // Hãy đảm bảo Google Script của bạn return ContentService.createTextOutput...
        });

        const result = await response.json();
        return result; 

    } catch (error) {
        console.error("Lỗi gửi Sheet:", error);
        return { status: "error", message: error.message };
    }
}
// ===== INIT =====
function initStatusSelectOptions() {
    if (!statusSelect) return;
    statusSelect.innerHTML = "";

    STATUS_CONFIG.forEach(st => {
        const opt = document.createElement("option");
        opt.value = st.value;
        opt.textContent = st.label;
        statusSelect.appendChild(opt);
    });
}


(async function init() {
    // 1. BẮT ĐẦU MÀN HÌNH CHỜ NGAY LẬP TỨC
    startLoaderSystem();
// --- KÍCH HOẠT HIỆU ỨNG MÙA ---
    initUnifiedEffects();
    closeApiKeyModal();
    // ------------------------------
    try {
        // --- Các tác vụ khởi tạo ---
        requireLoginOrRedirect();
        
        // Chạy song song các tác vụ nặng để tiết kiệm thời gian
        // (Thay vì await từng cái, ta dùng Promise.all)
        await Promise.all([
            syncAccountStatus(),
            fetchWordsFromSheet(),
            fetchIrregularVerbsFromSheet() // Tải sẵn cái này luôn cho nhanh
        ]);
        
        // Khởi tạo logic chạy ngầm
        startRealtimeLoop();
        startExpirationLoop();

        // Render giao diện
        updateUI_InitState();
        initStatusSelectOptions();
        renderWords();
        updateCount();
        updateStreak();
        updateFolderSuggestions();

        // Check SRS
        checkAndShowSRSPopup();

    } catch (err) {
        console.error("Init Error:", err);
        // Có thể hiện Toast báo lỗi ở đây nếu muốn
    } finally {
        // 2. QUAN TRỌNG: TẮT MÀN HÌNH CHỜ DÙ THÀNH CÔNG HAY THẤT BẠI
        // Để tránh user bị kẹt mãi ở màn hình loading
        stopLoaderSystem();
    }
})();

