// ===== CONFIG =====
const SHEET_WEB_APP_URL      = "https://script.google.com/macros/s/AKfycbwF4oukVU_5jSvTDq89Fv5wIVlgrdMiihyJeKdiR59P_DwSXVx78QphXcqZNiPYyCF-/exec"; // Web App VocabScript (/exec)
const LOGIN_API_URL          = "https://script.google.com/macros/s/AKfycbwKj6KkMYpMZn9uX17Mp4h7vuvANKJPScE4JTaZiNq9p6_gCSPcT7HK65Nd0iW7IA7Q/exec"; // Web App LoginScript (/exec)
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

let systemWords = []; // Từ thuộc khóa học (Template)
let userWords = [];   // Từ người dùng tự thêm (Sổ tay)
let words = [];
let currentUser = null;
let editingIndex = -1;
let activeFolder = null;      // null = chưa chọn folder
let currentFolderNames = []; 
let bulkData = []; // Biến chứa dữ liệu tạm thời
let availableVoices = [];
let viewedCountMap = {};  // Lưu trữ: {"Topic 1": 5, "Topic 2": 10}
let sessionViewedSet = new Set();
const PAGE_SIZE = 10;   // mỗi trang 10 từ
let currentPage = 1;
let learnList = [];       // Danh sách từ đang học
let learnIdx = 0;
let currentTopicName = "";

let jumpInterval = null;    // Interval chuyển từ
let countdownInterval = null; // Interval đếm ngược
let currentUtterance = null;
let isJumpingMode = false;

let repeatInterval = null;
let isRepeating = false;

let currentFillWordObj = null;

let currentScrambleWordObj = null;
let scrambleUserAnswer = [];

let currentDataMode = 'notebook';

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

            try {
                viewedCountMap = JSON.parse(data.progressData || "{}");
            } catch (e) {
                viewedCountMap = {};
            }
            localStorage.setItem("viewed_count", JSON.stringify(viewedCountMap));
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
        const cachedProgress = localStorage.getItem("viewed_count");
        if (cachedProgress) {
            viewedCountMap = JSON.parse(cachedProgress);
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
    
    // --- LẤY CẤU HÌNH TỪ HỒ SƠ ---
    const selectedVoiceName = localStorage.getItem("pref_voice");
    const selectedSpeed = localStorage.getItem("pref_speed") || 0.95;

    if (selectedVoiceName) {
        const voice = availableVoices.find(v => v.name === selectedVoiceName);
        if (voice) utter.voice = voice;
    }

    utter.lang = "en-US"; // Fallback nếu không chọn được giọng
    utter.rate = parseFloat(selectedSpeed);
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
     words = userWords;
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
    const sections = ['vocab', 'review', 'irregular', 'profile', 'lessons','learning'];
    
    // Lưu ý: Trong HTML cũ bạn đặt ID section hơi lộn xộn (cái thì ID, cái thì class nth-of-type).
    // Tốt nhất bạn nên đặt ID rõ ràng cho từng section trong HTML:
    // vocab-section, review-section, irregular-section, profile-section
    
    // Tạm thời ẩn theo cách cũ + thêm profile
    const vocabSec = document.querySelector('section.card:nth-of-type(1)');
    const listSec  = document.getElementById('list-card-section'); // Đã thêm ID này ở bài trước
    const reviewSec = document.getElementById('review-section');
    const irrSec    = document.getElementById('irregular-section');
    const profileSec = document.getElementById('profile-section');
    const lessonsSec = document.getElementById('lessons-section'); // MỚI
    const learnSec = document.getElementById('learning-section')

    if (vocabSec) vocabSec.style.display = 'none';
    if (listSec)  listSec.style.display  = 'none';
    if (reviewSec) reviewSec.style.display = 'none';
    if (irrSec)    irrSec.style.display    = 'none';
    if (profileSec) profileSec.style.display = 'none';
    if (lessonsSec) lessonsSec.style.display = 'none';
    if (learnSec) learnSec.style.display = 'none';
    // Xóa active class ở nav
    document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));

    // Hiện section được chọn
    if (sectionId === 'vocab') {
        if (vocabSec) vocabSec.style.display = 'block';
        if (listSec)  listSec.style.display  = 'block';
        // Active nút đầu tiên
        words = userWords;
        document.querySelector('.nav-item:nth-child(1)').classList.add('active');
    } 
    else if (sectionId === 'review') {
         words = userWords;
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
         words = userWords;
        if (profileSec) profileSec.style.display = 'block';
        // Active nút thứ 4
        document.querySelector('.nav-item:nth-child(5)').classList.add('active');
        
        // Render lại UI Profile mỗi khi vào đây để đảm bảo data mới nhất
        renderUserProfileData();
    }
    else if (sectionId === 'lessons') {
        if (lessonsSec) lessonsSec.style.display = 'block';
         words = systemWords;
        // Mặc định luôn hiện view danh sách khóa học khi mới bấm vào
        document.querySelector('.nav-item:nth-child(4)').classList.add('active');
        document.getElementById("course-list-view").style.display = "block";
        document.getElementById("topic-list-view").style.display = "none";
        
        renderCourses(); // Render Level 1
        
        // Active nav button
        const btn = Array.from(document.querySelectorAll('.nav-item')).find(b => b.getAttribute('onclick')?.includes('lessons'));
        if(btn) btn.classList.add('active');
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
        startScrambleMode();
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
    const currentWord = reviewList[currentReviewIdx];
    // Kiểm tra nếu thẻ đang lật sang mặt sau (hoặc vừa ấn lật) thì phát âm
    // Ở đây chúng ta sẽ lấy từ đang hiển thị ở mặt trước để phát âm
    const wordText = document.getElementById("fc-word").textContent;
    
    if (wordText && wordText !== "Word") {
        playPronunciation(wordText);
    }
}

function nextFlashcard() {
    stopJumpingMode();
    
    if (currentReviewIdx < reviewList.length - 1) {
        currentReviewIdx++;
        renderFlashcard();
    } 
    else
    {
        showCelebration();
    }
}

function prevFlashcard() {
    if (currentReviewIdx > 0) {
        currentReviewIdx--;
        renderFlashcard();
    }
}

function startFlashcardFromTopic(topicName) {
    // Lọc từ
    const topicWords = words.filter(w => w.folder === topicName);
    if (topicWords.length === 0) {
        showToast("Chủ đề này chưa có từ nào!", "error");
        return;
    }

    // Setup dữ liệu riêng
    learnList = [...topicWords]; 
    learnIdx = 0;
    currentTopicTitle = topicName;

    // Chuyển giao diện
    // Ẩn hết các section chính
    document.querySelectorAll('section.card').forEach(el => el.style.display = 'none');
    document.getElementById('list-card-section').style.display = 'none'; // Ẩn list nếu có
    document.getElementById('lessons-section').style.display = 'none';   // Ẩn menu lesson

    // HIỆN SECTION HỌC TẬP RIÊNG
    const learnSec = document.getElementById('learning-section');
    learnSec.style.display = 'block';
    
    // Reset View: Hiện Card, Ẩn Summary
    document.getElementById('learning-card-container').style.display = 'flex';
    document.getElementById('topic-summary-view').style.display = 'none';

    // Cập nhật Header
    document.getElementById('learning-topic-title').textContent = topicName;

    // Render thẻ đầu tiên
    renderTopicCard();
}

function renderTopicCard() {
    const w = learnList[learnIdx];
    const cardEl = document.getElementById('topic-flashcard-el');
    
    // Reset lật thẻ
    cardEl.classList.remove('is-flipped');

    // Điền dữ liệu (Delay nhẹ để animation lật về mượt hơn nếu cần)
    setTimeout(() => {
        document.getElementById('learn-word').textContent = w.word;
        document.getElementById('learn-ipa').textContent = w.ipa || "";
        document.getElementById('learn-meaning').textContent = w.meaning;
        document.getElementById('learn-sentence').textContent = w.sentence || "No example.";
        document.getElementById('learn-type').textContent = w.type || "word";
        
        // Cập nhật số trang
        document.getElementById('learning-progress-text').textContent = `${learnIdx + 1} / ${learnList.length}`;
        
        // Tự động phát âm khi hiện thẻ mới (Mặt trước)
        playPronunciation(w.word);
    }, 200);
}

// 3. LẬT THẺ (Chỉ dành cho Topic Card)
function flipTopicCard() {
    const card = document.getElementById('topic-flashcard-el');
    card.classList.toggle('is-flipped');
    
    // Nếu lật ra sau -> Phát âm lại (hoặc tùy bạn)
    // if(card.classList.contains('is-flipped')) playPronunciation(learnList[learnIdx].word);
}

// 4. TIẾP THEO (Logic Đánh dấu + Chuyển)
function nextTopicCard() {
    stopRepeatOne();
    // A. Đánh dấu đã xem (Lưu tiến độ vào Sheet Users)
    const currentWord = learnList[learnIdx];
    markAsViewed(currentWord); 

    // B. Chuyển thẻ
    if (learnIdx < learnList.length - 1) {
        learnIdx++;
        renderTopicCard();
    } else {
        // Hết thẻ -> Hiện Summary
        showTopicSummary();
    }
}

function showTopicSummary() {
    document.getElementById('learning-card-container').style.display = 'none';
    document.getElementById('topic-summary-view').style.display = 'block';
    
    // Render list để chọn lưu (Dùng lại logic render cũ nhưng đổi nguồn dữ liệu là learnList)
    renderSummaryListCheckboxes(); 
}

function renderSummaryListCheckboxes() {
    const container = document.getElementById("summary-list-container");
    container.innerHTML = "";
    document.getElementById("check-all-summary").checked = false;
    document.getElementById("selected-count").textContent = "0 đã chọn";

    learnList.forEach((w, index) => {
        // Check xem đã có trong Sổ tay chưa (userWords là biến global chứa từ riêng)
        const isSaved = userWords.some(u => u.word.toLowerCase() === w.word.toLowerCase());

        const div = document.createElement("div");
        div.className = `summary-item ${isSaved ? 'already-saved' : ''}`;
        
        const checkboxHtml = isSaved 
            ? `<input type="checkbox" class="summary-checkbox" disabled>`
            : `<input type="checkbox" class="summary-checkbox" value="${index}" onchange="updateSummaryCount()">`;

        div.innerHTML = `
            ${checkboxHtml}
            <div class="summary-content" onclick="toggleSummaryRow(this)">
                <div class="summary-word">${w.word}</div>
                <div class="summary-mean">${w.meaning}</div>
            </div>
        `;
        container.appendChild(div);
    });
}


function toggleSummaryRow(el) {
    const cb = el.parentElement.querySelector('.summary-checkbox');
    if(!cb.disabled) {
        cb.checked = !cb.checked;
        updateSummaryCount();
    }
}

function updateSummaryCount() {
    const count = document.querySelectorAll('#summary-list-container .summary-checkbox:checked').length;
    document.getElementById('selected-count').textContent = `${count} đã chọn`;
}

function toggleCheckAllSummary() {
    const isChecked = document.getElementById("check-all-summary").checked;
    document.querySelectorAll('#summary-list-container .summary-checkbox:not(:disabled)').forEach(cb => cb.checked = isChecked);
    updateSummaryCount();
}
// Hàm kết thúc phiên học -> Hiện list
function finishTopicSession() {
    document.getElementById('mode-flashcard').style.display = 'none';
    document.getElementById('topic-summary-view').style.display = 'block';
    
    renderSummaryList();
}

function renderSummaryList() {
    const container = document.getElementById("summary-list-container");
    container.innerHTML = "";
    
    // Reset nút chọn tất cả
    document.getElementById("check-all-summary").checked = false;
    updateSelectedCount();

    reviewList.forEach((w, index) => {
        // Kiểm tra xem từ này đã có trong User Words chưa (để disable hoặc đánh dấu)
        // Giả sử userWords là mảng từ vựng riêng của user
        const isSaved = userWords.some(u => u.word.toLowerCase() === w.word.toLowerCase());

        const div = document.createElement("div");
        div.className = `summary-item ${isSaved ? 'already-saved' : ''}`;
        
        // Nếu chưa lưu thì mới cho check, đã lưu rồi thì disable
        const checkboxHtml = isSaved 
            ? `<input type="checkbox" class="summary-checkbox" disabled>`
            : `<input type="checkbox" class="summary-checkbox" value="${index}" onchange="updateSelectedCount()">`;

        div.innerHTML = `
            ${checkboxHtml}
            <div class="summary-content" onclick="toggleSummaryCheck(this)">
                <div class="summary-word">${w.word} <span style="font-weight:normal; font-size:12px; color:#6b7280;">${w.ipa || ""}</span></div>
                <div class="summary-mean">${w.meaning}</div>
            </div>
        `;
        container.appendChild(div);
    });
}

// Helper: Click vào dòng cũng check được checkbox
function toggleSummaryCheck(el) {
    const checkbox = el.parentElement.querySelector('.summary-checkbox');
    if (!checkbox.disabled) {
        checkbox.checked = !checkbox.checked;
        updateSelectedCount();
    }
}

async function saveSelectedSummaryWords() {
    if (!checkAccess()) return;

    const checkboxes = document.querySelectorAll('#summary-list-container .summary-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast("Chưa chọn từ nào!", "warning");
        return;
    }

    const btn = document.getElementById("btn-save-summary");
    btn.textContent = "⏳ Đang lưu...";
    btn.disabled = true;

    let successCount = 0;
    
    // Xử lý lưu
    for (const cb of checkboxes) {
        const idx = parseInt(cb.value);
        const w = learnList[idx];
        
        const newWord = {
            word: w.word, meaning: w.meaning, ipa: w.ipa, type: w.type, sentence: w.sentence,
            folder: "Từ đã lưu", status: "new", dateAdded: new Date().toISOString().slice(0, 10)
        };

        try {
            await sendWordToGoogleSheet_Add(newWord); // Gửi API
            // Add local
            userWords.push({...newWord, isSystem: false, canEdit: true, course: "Sổ tay"});
            successCount++;
        } catch(e) { console.error(e); }
    }

    btn.textContent = "💾 Lưu vào Sổ tay";
    btn.disabled = false;
    showToast(`Đã lưu ${successCount} từ!`, "success");
    
    // Refresh list để disable checkbox
    renderSummaryListCheckboxes();
    combineAndRenderWords(); // Update list chính
    words = systemWords;
}

function closeSummaryView() {
    // Quay về danh sách Topic
    document.getElementById('topic-summary-view').style.display = 'none';
    showSection('lessons');
    
    // Cập nhật lại thanh tiến độ Topic (vì vừa học xong)
    // Tìm config của khóa hiện tại để reload
    const currentCourseTitle = document.getElementById("current-course-title").textContent;
    const config = COURSES_CONFIG.find(c => c.title === currentCourseTitle);
    if(config) openCourseDetail(config);
}
function stopAutoPlayPopup() {
    isJumpingMode = false;
    
    // Xóa các bộ đếm
    clearInterval(jumpInterval);
    clearInterval(countdownInterval);
    
    // Dừng đọc ngay lập tức
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    // Đóng Modal
    document.getElementById("auto-play-modal").style.display = "none";
}
function closeLearningMode() {

    stopJumpingMode();
    // Ẩn section học
    document.getElementById('learning-section').style.display = 'none';
    
    // Hiện lại màn hình bài học & Topic List
    document.getElementById('lessons-section').style.display = 'block';
    
    // Update lại thanh tiến độ Topic ở màn hình List (vì vừa học xong)
    // Logic tìm config khóa học hiện tại để reload
    const currentCourse = document.getElementById("current-course-title").textContent;
    const config = COURSES_CONFIG.find(c => c.title === currentCourse);
    if(config) openCourseDetail(config);
}

// Helper: Cập nhật số lượng đang chọn
function updateSelectedCount() {
    const checkboxes = document.querySelectorAll('.summary-checkbox:checked');
    document.getElementById('selected-count').textContent = `Đã chọn: ${checkboxes.length}`;
}

// Helper: Chọn tất cả


// 1. Hàm Bắt đầu Game (Gọi từ menu)
function startFillMode() {
    // Ẩn các section khác, chỉ hiện game điền từ
    document.querySelectorAll('section.card').forEach(el => el.style.display = 'none');
    document.getElementById('review-section').style.display = 'block';
    
    // Ẩn menu con trong review, hiện game fill
    document.getElementById('review-menu').style.display = 'none';
    document.getElementById('mode-flashcard').style.display = 'none';
    document.getElementById('mode-scramble').style.display = 'none';
    document.getElementById('mode-fill').style.display = 'block';
    document.getElementById('topic-summary-view').style.display = 'none';

    // Nếu chưa có list review thì lấy random 10 từ
    if (!reviewList || reviewList.length === 0) {
        if(words.length > 0) {
             reviewList = userWords.sort(() => Math.random() - 0.5).slice(0, 10);
        } else {
             showToast("Chưa có dữ liệu từ vựng!", "error");
             return;
        }
    }
    
    currentReviewIdx = 0;
    renderFillQuestion();
}

// 2. Render câu hỏi
function renderFillQuestion() {
    // Kiểm tra nếu hết câu hỏi
    if (currentReviewIdx >= reviewList.length) {
        showCelebration(); // <--- Gọi hàm chúc mừng thay vì showToast
        return;
    }

    currentFillWordObj = reviewList[currentReviewIdx];
    
    // Reset ô Input
    const input = document.getElementById('fill-input');
    input.value = "";
    input.className = "fill-input"; // Xóa class correct/wrong cũ (trở về màu trắng)
    input.disabled = false;
    
    // Gợi ý độ dài từ (Placeholder)
    input.placeholder = `(${currentFillWordObj.word.length} ký tự) Gõ từ tiếng Anh...`;
    
    // Reset icon kết quả
    const icon = document.getElementById('fill-status-icon');
    if(icon) icon.style.display = 'none';
    
    // Hiển thị Nghĩa & IPA
    document.getElementById('fill-mean').textContent = currentFillWordObj.meaning;
    
    // Nếu có thẻ IPA thì hiện, không thì thôi
    const ipaEl = document.getElementById('fill-ipa');
    if(ipaEl) ipaEl.textContent = currentFillWordObj.ipa || "";
    
    // Tự động focus để gõ luôn không cần bấm chuột
    setTimeout(() => input.focus(), 100);
}

// 3. Kiểm tra đáp án
function checkFillAnswer() {
    const input = document.getElementById('fill-input');
    const userVal = input.value.trim().toLowerCase();
    const correctVal = currentFillWordObj.word.toLowerCase();
    
    // Reset hiệu ứng rung lắc (để nếu sai tiếp nó vẫn rung lại)
    input.classList.remove('wrong');
    void input.offsetWidth; // Hack: Trigger reflow để reset animation

    if (userVal === correctVal) {
        // --- TRƯỜNG HỢP ĐÚNG ---
        input.classList.add('correct'); // Chuyển xanh
        input.disabled = true; // Khóa không cho sửa
        
        // Hiện icon check
        const icon = document.getElementById('fill-status-icon');
        if(icon) {
            icon.textContent = "✅";
            icon.style.display = "block";
        }
        
        playPronunciation(correctVal); // Đọc từ
        // showToast("Chính xác!", "success"); // Có thể bỏ nếu thấy phiền

        // Tự động chuyển câu sau 1.2s (để người dùng kịp nhìn kết quả)
        setTimeout(() => {
            nextFillWord();
        }, 1200);

    } else {
        // --- TRƯỜNG HỢP SAI ---
        input.classList.add('wrong'); // Chuyển đỏ & Rung lắc
        showToast("Sai rồi, thử lại nhé!", "error");
        input.focus();
    }
}

// 4. Chuyển câu tiếp theo
function nextFillWord() {
    currentReviewIdx++;
    renderFillQuestion();
}

const fillInputEl = document.getElementById('fill-input');
if (fillInputEl) {
    // Xóa listener cũ nếu có (để tránh bị double click - mẹo cloning)
    const newEl = fillInputEl.cloneNode(true);
    fillInputEl.parentNode.replaceChild(newEl, fillInputEl);
    
    newEl.addEventListener("keypress", function(event) {
        if (event.key === "Enter") {
            event.preventDefault();
            checkFillAnswer();
        }
    });
    // Gán lại ID để các hàm khác tìm thấy
    newEl.id = "fill-input"; 
}

// ==========================================
// SCRAMBLE GAME LOGIC (SẮP XẾP CHỮ)
// ==========================================


function startScrambleMode() {
    // Ẩn các mode khác
    document.querySelectorAll('section.card').forEach(el => el.style.display = 'none');
    document.getElementById('review-section').style.display = 'block';
    
    document.getElementById('review-menu').style.display = 'none';
    document.getElementById('mode-flashcard').style.display = 'none';
    document.getElementById('mode-fill').style.display = 'none';
    document.getElementById('topic-summary-view').style.display = 'none';
    document.getElementById('mode-scramble').style.display = 'block';
    
    // Tạo list câu hỏi nếu chưa có
    if (!reviewList || reviewList.length === 0) {
        if(words.length > 0) {
             reviewList = userWords.sort(() => Math.random() - 0.5).slice(0, 10);
             currentReviewIdx = 0;
        } else {
             showToast("Chưa có dữ liệu từ vựng!", "error");
             return;
        }
    }
    
    currentReviewIdx = 0;
    renderScrambleQuestion();
}

function renderScrambleQuestion() {
    // 1. Kiểm tra kết thúc game
    if (currentReviewIdx >= reviewList.length) {
        showCelebration();
        return;
    }

    // 2. Lấy từ hiện tại
    currentScrambleWordObj = reviewList[currentReviewIdx];
    
    // [FIX LỖI]: Nếu từ bị lỗi (undefined hoặc không có word), tự động next
    if (!currentScrambleWordObj || !currentScrambleWordObj.word) {
        console.warn("Phát hiện từ lỗi, đang tự động bỏ qua...", currentReviewIdx);
        currentReviewIdx++;
        renderScrambleQuestion(); // Đệ quy gọi lại ngay
        return;
    }

    const correctWord = currentScrambleWordObj.word.toUpperCase();
    
    // Reset mảng câu trả lời
    scrambleUserAnswer = new Array(correctWord.length).fill(null); 
    
    // 3. Hiển thị thông tin lên màn hình
    const meanEl = document.getElementById('scramble-mean');
    if(meanEl) meanEl.textContent = currentScrambleWordObj.meaning || "(Chưa có nghĩa)";
    
    const fbEl = document.getElementById('scramble-feedback');
    if(fbEl) {
        fbEl.textContent = "Bấm vào chữ cái để sắp xếp";
        fbEl.style.color = "#64748b";
    }

    // 4. Render Ô trống (Slots)
    const slotsArea = document.getElementById('scramble-slots-area');
    slotsArea.innerHTML = "";
    
    for (let i = 0; i < correctWord.length; i++) {
        const slot = document.createElement("div");
        slot.className = "scramble-slot";
        slot.dataset.index = i;
        slot.onclick = () => undoScrambleLetter(i);
        slotsArea.appendChild(slot);
    }

    // 5. Render Ký tự đảo lộn (Pool)
    const poolArea = document.getElementById('scramble-pool-area');
    poolArea.innerHTML = "";
    
    let chars = correctWord.split("");
    // Xáo trộn mảng
    for (let i = chars.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [chars[i], chars[j]] = [chars[j], chars[i]];
    }

    chars.forEach((char, idx) => {
        const btn = document.createElement("button");
        btn.className = "pool-btn";
        btn.textContent = char;
        btn.dataset.char = char;
        btn.dataset.poolId = idx;
        btn.onclick = () => selectScrambleLetter(char, idx, btn);
        poolArea.appendChild(btn);
    });
}

// Xử lý khi chọn 1 ký tự từ Pool
function selectScrambleLetter(char, poolId, btnElement) {
    const correctWord = currentScrambleWordObj.word.toUpperCase();
    
    // 1. Tìm ô trống đầu tiên
    const emptyIndex = scrambleUserAnswer.findIndex(val => val === null);
    
    if (emptyIndex === -1) return; // Đã đầy ô

    // 2. Điền vào mảng dữ liệu
    scrambleUserAnswer[emptyIndex] = { char: char, poolId: poolId };
    
    // 3. Cập nhật giao diện Ô Slot
    const slots = document.querySelectorAll('.scramble-slot');
    const targetSlot = slots[emptyIndex];
    
    targetSlot.textContent = char;
    targetSlot.classList.add('filled');
    
    // 4. KIỂM TRA NGAY LẬP TỨC (Correct/Wrong)
    const correctChar = correctWord[emptyIndex];
    if (char === correctChar) {
        targetSlot.classList.add('correct');
        targetSlot.classList.remove('wrong');
    } else {
        targetSlot.classList.add('wrong');
        targetSlot.classList.remove('correct');
        
        // Rung nhẹ điện thoại nếu sai (nếu thiết bị hỗ trợ)
        if(navigator.vibrate) navigator.vibrate(50);
    }

    // 5. Ẩn nút ở Pool đi
    btnElement.classList.add('used');

    // 6. Kiểm tra xem đã xong chưa
    checkScrambleWin();
}

// Xử lý khi bấm vào ô Slot để trả lại ký tự (Undo)
function undoScrambleLetter(index) {
    const data = scrambleUserAnswer[index];
    if (!data) return; // Ô đang trống

    // 1. Reset ô Slot
    const slots = document.querySelectorAll('.scramble-slot');
    const targetSlot = slots[index];
    
    targetSlot.textContent = "";
    targetSlot.className = "scramble-slot"; // Reset hết class màu
    
    // 2. Hiện lại nút ở Pool
    // Tìm nút có poolId tương ứng để hiện lại
    const poolBtns = document.querySelectorAll('.pool-btn');
    poolBtns.forEach(btn => {
        if (btn.dataset.poolId == data.poolId) {
            btn.classList.remove('used');
        }
    });

    // 3. Xóa khỏi mảng dữ liệu
    scrambleUserAnswer[index] = null;
    
    // (Logic nâng cao: Nếu xóa ô giữa, có thể cần dồn các ô sau lên, 
    // nhưng để đơn giản ta cứ để trống ô đó chờ điền lại)
}

function checkScrambleWin() {
    // Kiểm tra xem mảng đã đầy chưa và có ô nào sai không
    const isFull = scrambleUserAnswer.every(val => val !== null);
    if (!isFull) return;

    const correctWord = currentScrambleWordObj.word.toUpperCase();
    
    // Kiểm tra từng ký tự
    let isAllCorrect = true;
    scrambleUserAnswer.forEach((item, idx) => {
        if (item.char !== correctWord[idx]) isAllCorrect = false;
    });

    if (isAllCorrect) {
        // --- CHIẾN THẮNG ---
        const fb = document.getElementById('scramble-feedback');
        fb.textContent = "Chính xác! 🎉";
        fb.style.color = "#16a34a";
        
        playPronunciation(currentScrambleWordObj.word);

        // Tự động chuyển sau 1s
        setTimeout(() => {
            nextScrambleWord();
        }, 1000);
    } else {
        // Nếu đầy mà vẫn sai -> Báo lỗi
        const fb = document.getElementById('scramble-feedback');
        fb.textContent = "Chưa đúng, hãy sửa các ô màu đỏ!";
        fb.style.color = "#ef4444";
    }
}

function nextScrambleWord() {
    currentReviewIdx++;
    renderScrambleQuestion();
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
    }, 1500);

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
    { name: "Tet_2025",      month: 2,  day: 17, icon: "🌸", duration: 10 }, // Tết Âm 2025 (Cần cập nhật hàng năm)
    { name: "Valentine",     month: 2,  day: 14, icon: "❤️", duration: 3 }, // Tim bay
    { name: "Halloween",     month: 10, day: 31, icon: "🎃", duration: 5 }, // Bí ngô
    { name: "HungKings",     month: 4,  day: 26,  icon: "🇻🇳", duration: 1 }, // Giỗ tổ (10/3 Âm - Ví dụ năm 2025 là 6/4 Dương)
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

    const folderInput = document.getElementById("bulk-folder"); // ID mới
    const targetFolder = (folderInput && folderInput.value.trim()) 
                         ? folderInput.value.trim() 
                         : "Chung";

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

function loadVoiceOptions() {
    // 1. Lấy danh sách giọng hiện có
    availableVoices = window.speechSynthesis.getVoices();
    const voiceSelect = document.getElementById("voice-select");
    
    // Nếu chưa lấy được element hoặc danh sách rỗng -> thử lại sau
    if (!voiceSelect) return; 
    
    // 2. Xử lý trường hợp danh sách rỗng (Đặc thù Mobile)
    if (availableVoices.length === 0) {
        // Vẫn giữ "Đang tải..." nhưng không xóa đi vội
        // Thử lại sau 500ms (Cơ chế Retry)
        setTimeout(loadVoiceOptions, 500); 
        return;
    }

    // 3. Lọc giọng Tiếng Anh (en) để danh sách đỡ dài
    const enVoices = availableVoices.filter(v => v.lang.includes('en'));
    
    // Nếu không tìm thấy giọng tiếng Anh nào, lấy tất cả
    const voicesToShow = enVoices.length > 0 ? enVoices : availableVoices;

    // 4. Vẽ lại Select Box
    voiceSelect.innerHTML = voicesToShow.map(v => 
        `<option value="${v.name}" ${v.name === localStorage.getItem("pref_voice") ? 'selected' : ''}>
            ${v.name} (${v.lang})
        </option>`
    ).join('');
    
    // Thêm tùy chọn mặc định nếu thích
    if(voicesToShow.length === 0) {
         voiceSelect.innerHTML = '<option value="">Google US English (Mặc định)</option>';
    }

    // Load tốc độ đã lưu
    const savedSpeed = localStorage.getItem("pref_speed");
    if (savedSpeed) {
        document.getElementById("voice-speed").value = savedSpeed;
        document.getElementById("speed-val").innerText = savedSpeed + "x";
    }
}
loadVoiceOptions();

// Lắng nghe sự kiện thay đổi giọng của hệ thống
window.speechSynthesis.onvoiceschanged = loadVoiceOptions;

// 2. Lưu cài đặt khi người dùng thay đổi
document.addEventListener("change", (e) => {
    if (e.target.id === "voice-select") {
        localStorage.setItem("pref_voice", e.target.value);
    }
    if (e.target.id === "voice-speed") {
        localStorage.setItem("pref_speed", e.target.value);
    }
});

function testCurrentVoice() {
    playPronunciation("Welcome to TNC English. This is a voice test.");
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

// Cấu hình các khóa học (Level 1)
const COURSES_CONFIG = [
    {
        id: "basic_1000",
        title: "1000 Từ Cơ Bản",
        sheetName: "Basic 1000", // Giống cột G
        desc: "Từ vựng nền tảng giao tiếp hàng ngày",
        icon: "🎯",
        bgClass: "bg-blue"
    },
    {
        id: "toeic_course",
        title: "Các câu thành ngữ tục ngữ",
        sheetName: "Idiom",      // Giống cột G
        desc: "Câu thành ngữ tục ngữ phổ biến",
        icon: "📝",
        bgClass: "bg-orange"
    }
    // Bạn có thể thêm khóa IELTS, giao tiếp... vào đây
];
// Hàm Render Level 1: Danh sách Khóa học
function renderCourses() {
    words = systemWords;
    const container = document.getElementById("course-list-container");
    if (!container) return;
    container.innerHTML = "";

    COURSES_CONFIG.forEach(config => {
        // 1. Lọc từ thuộc khóa này
        const courseWords = words.filter(w => w.course === config.sheetName);
        const total = courseWords.length;

        // 2. Tính tổng số đã xem (Cộng dồn các topic con)
        let totalViewed = 0;
        // Lấy danh sách các topic duy nhất trong khóa này
        const uniqueTopics = [...new Set(courseWords.map(w => w.folder))];
        
        uniqueTopics.forEach(topic => {
            totalViewed += (viewedCountMap[topic] || 0);
        });

        const percent = total === 0 ? 0 : Math.floor((totalViewed / total) * 100);

        const div = document.createElement("div");
        div.className = "lesson-card";
        div.onclick = () => openCourseDetail(config);

        div.innerHTML = `
            <div class="lesson-header">
                <div class="lesson-icon-box ${config.bgClass}">${config.icon}</div>
                <div class="lesson-info">
                    <h3 class="lesson-title">${config.title}</h3>
                    <p class="lesson-desc">${total} từ • ${uniqueTopics.length} chủ đề</p>
                </div>
            </div>
            <div class="lesson-progress-wrapper">
                <div class="progress-track">
                    <div class="progress-fill" style="width: ${percent}%"></div>
                </div>
                <div class="progress-stats" style="margin-top:6px;">
                    <span>Đã xem: ${totalViewed}/${total}</span>
                    <span style="color:#3b82f6; font-weight:bold;">${percent}%</span>
                </div>
            </div>
        `;
        container.appendChild(div);
    });
}

function markAsViewed(wordObj) {
    if (!wordObj) return;

    // Lấy Topic (Cột F)
    const topic = wordObj.folder || "Chưa phân loại";
    // Tạo key duy nhất để trong 1 phiên không bị cộng dồn liên tục
    const key = topic + "_" + wordObj.word;

    // Nếu trong phiên này đã xem rồi -> Bỏ qua
    if (sessionViewedSet.has(key)) return;

    // Nếu chưa xem -> Đánh dấu
    sessionViewedSet.add(key);

    // Khởi tạo đếm nếu chưa có
    if (!viewedCountMap[topic]) viewedCountMap[topic] = 0;

    // Kiểm tra giới hạn (Không được vượt quá tổng số từ của topic)
    const maxWords = words.filter(w => w.folder === topic).length;
    
    if (viewedCountMap[topic] < maxWords) {
        viewedCountMap[topic]++; // Tăng 1
        
        // Lưu Local & Gửi Server
        localStorage.setItem("viewed_count", JSON.stringify(viewedCountMap));
        saveProgressToServer();
        
        // Nếu đang mở màn hình danh sách Topic -> Cập nhật thanh màu xanh ngay lập tức
        updateTopicProgressBar(topic, viewedCountMap[topic], maxWords);
    }
}

async function saveProgressToServer() {
    if (!currentUser) return;
    try {
        await fetch(LOGIN_API_URL, {
            method: "POST", mode: "cors",
            body: JSON.stringify({
                action: "saveProgress", // Khớp với Code.gs mới
                email: currentUser.email,
                progressData: JSON.stringify(viewedCountMap) // Gửi chuỗi {"Topic 1": 5...}
            })
        });
        console.log("Đã đồng bộ tiến độ.");
    } catch (e) { console.error(e); }
}

function updateTopicProgressBar(topicName, currentVal, maxVal) {
    // Tìm thanh tiến độ của topic này trong DOM (nếu đang hiển thị)
    // Cách đơn giản: Nếu đang ở view Topic, render lại list
    const topicView = document.getElementById("topic-list-view");
    if (topicView && topicView.style.display === "block") {
        // Tìm khóa học đang mở để render lại đúng nó
        const courseTitle = document.getElementById("current-course-title").textContent;
        const config = COURSES_CONFIG.find(c => c.title === courseTitle);
        if (config) {
            // Render lại nhẹ nhàng (để cập nhật số)
            renderTopicList(config); 
        }
    }
}

// Hàm Render Level 2: Danh sách Chủ đề (Khi bấm vào 1 khóa học)
function openCourseDetail(config) {
    // Chuyển View
    document.getElementById("course-list-view").style.display = "none";
    document.getElementById("topic-list-view").style.display = "block";
    document.getElementById("current-course-title").textContent = config.title;

    renderTopicList(config);
}

function renderTopicList(config) {
    const container = document.getElementById("topic-list-container");
    container.innerHTML = "";

    // Lọc từ & Group theo Topic
    const courseWords = words.filter(w => w.course === config.sheetName);
    const topicMap = {};

    courseWords.forEach(w => {
        const t = w.folder || "Chưa phân loại";
        if (!topicMap[t]) topicMap[t] = { name: t, total: 0, icon: getRandomEmoji(t) };
        topicMap[t].total++;
    });

    // Sort Topic 1, Topic 2...
    const sortedTopics = Object.values(topicMap).sort((a, b) => {
        return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
    });
    
    // Tính tổng progress cho Header
    let grandTotal = 0;
    let grandViewed = 0;

    sortedTopics.forEach(topic => {
        grandTotal += topic.total;
        grandViewed += (viewedCountMap[topic.name] || 0);
        
        // --- RENDER TỪNG ITEM ---
        const viewed = viewedCountMap[topic.name] || 0;
        const percent = Math.floor((viewed / topic.total) * 100);
        let color = "#60a5fa"; // Xanh dương
        if(percent >= 100) color = "#10b981"; // Xanh lá

        const div = document.createElement("div");
        div.className = "topic-item";
        div.onclick = () => {
    // Gọi hàm mới vừa viết ở bước 1
    startFlashcardFromTopic(topic.name);
};

        div.innerHTML = `
            <div class="topic-content">
                <div class="topic-icon">${topic.icon}</div>
                <div class="topic-name">${topic.name}</div>
            </div>
            <div class="topic-progress-track">
                <div class="topic-progress-fill" style="width: ${percent}%; background: ${color}"></div>
            </div>
            <div style="text-align:right; font-size:10px; color:#9ca3af; margin-top:4px;">
                ${viewed}/${topic.total}
            </div>
        `;
        container.appendChild(div);
    });

    // Update Header Progress
    const grandPercent = grandTotal === 0 ? 0 : Math.floor((grandViewed/grandTotal)*100);
    document.getElementById("course-total-progress").style.width = `${grandPercent}%`;
    document.getElementById("course-progress-text").textContent = `${grandViewed} / ${grandTotal}`;
}

// Hàm quay lại danh sách khóa học
function backToCourses() {
    document.getElementById("topic-list-view").style.display = "none";
    document.getElementById("course-list-view").style.display = "block";
}

// Hàm helper sinh icon ngẫu nhiên dựa trên tên topic (để đỡ nhàm chán)
function getRandomEmoji(str) {
    const emojis = ["🐶", "🎨", "🍎", "🏠", "🏫", "👨‍👩‍👧", "🥞", "🚗", "⚽", "👗", "💻", "🌳"];
    // Hash đơn giản từ string để icon cố định cho mỗi topic
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % emojis.length;
    return emojis[index];
}
async function fetchSystemWords() {
    // Gọi vào Script Login (Nơi chứa TemplateWord)
    const url = `${LOGIN_API_URL}?action=getWords`;
    console.log("⬇️ Đang tải từ vựng hệ thống...");

    try {
        const res = await fetch(url);
        const data = await res.json();

        if (data.status === "success" && Array.isArray(data.words)) {
            // Đánh dấu đây là từ hệ thống (isSystem = true)
            systemWords = data.words.map(w => ({
                ...w,
                isSystem: true,      // Cờ đánh dấu: Đây là từ hệ thống
                canEdit: false       // Không cho sửa/xóa
            }));
            console.log(`✅ Đã tải ${systemWords.length} từ hệ thống.`);
        } else {
            systemWords = [];
        }
    } catch (err) {
        console.error("Lỗi tải từ hệ thống:", err);
        systemWords = [];
    }
}

async function fetchUserWords() {
    if (!currentUser || !currentUser.email) return;
    
    // Gọi vào Script Sheet Cá nhân của người dùng (SHEET_WEB_APP_URL)
    // URL này cần truyền email để sheet lọc đúng dòng của user (nếu dùng chung sheet)
    // Hoặc chỉ đơn giản là GET nếu mỗi user 1 sheet riêng.
    const url = `${SHEET_WEB_APP_URL}?userEmail=${encodeURIComponent(currentUser.email)}`;
    console.log("⬇️ Đang tải từ vựng cá nhân...");

    try {
        const res = await fetch(url);
        const data = await res.json();

        if (data.status === "success" && Array.isArray(data.words)) {
            // Đánh dấu đây là từ cá nhân (isSystem = false)
            userWords = data.words.map(w => ({
                rowIndex: w.rowIndex || null,
                word: w.word || "",
                folder: w.folder || "",
                ipa: w.ipa || "",
                type: w.type || "",
                meaning: w.meaning || "",
                sentence: w.sentence || "",
                dateAdded: w.dateAdded || "",
                status: w.status || "",
                isSystem: false,     // Cờ đánh dấu: Đây là từ cá nhân
                canEdit: true,       // Cho phép sửa/xóa
                course: "Sổ tay"     // Gom hết vào 1 khóa ảo tên là Sổ tay
            }));
            console.log(`✅ Đã tải ${userWords.length} từ cá nhân.`);
        } else {
            userWords = [];
        }
    } catch (err) {
        console.error("Lỗi tải từ cá nhân:", err);
        userWords = [];
    }
}

function toggleRepeatOne() {
    if (isRepeating) {
        stopRepeatOne();
    } else {
        startRepeatOne();
    }
}

function startRepeatOne() {
    // 1. Tắt chế độ Auto Play ngẫu nhiên nếu đang chạy (để không bị đá nhau)
    if (typeof isAutoPlaying !== 'undefined' && isAutoPlaying) {
        stopAutoPlay();
    }

    isRepeating = true;
    
    // Đổi giao diện nút
    const btn = document.getElementById("btn-repeat-one");
    if (btn) {
        btn.innerHTML = "⏹️ Dừng lặp";
        btn.style.background = "#dbeafe"; // Xanh đậm hơn chút
        btn.style.borderColor = "#2563eb";
        btn.style.fontWeight = "700";
    }

    showToast("Bắt đầu lặp lại từ hiện tại...", "info");

    // Đọc ngay lần đầu
    speakCurrentWord();

    // Lặp lại mỗi 2.5 giây (hoặc 3s tùy độ dài từ)
    repeatInterval = setInterval(() => {
        speakCurrentWord();
    }, 1500); 
}

function stopRepeatOne() {
    isRepeating = false;
    clearInterval(repeatInterval);
    
    // Reset nút về ban đầu
    const btn = document.getElementById("btn-repeat-one");
    if (btn) {
        btn.innerHTML = "🔁 Lặp từ này";
        btn.style.background = "#eff6ff";
        btn.style.borderColor = "#3b82f6";
        btn.style.fontWeight = "400";
    }
}

function speakCurrentWord() {
    // Lấy từ đang hiển thị
    // (Biến learnList và learnIdx đã có sẵn ở logic module học tập)
    if (learnList && learnList[learnIdx]) {
        playPronunciation(learnList[learnIdx].word);
    }
}

function toggleJumpingMode() {
    if (isJumpingMode) {
        stopJumpingMode();
    } else {
        startJumpingMode();
    }
}

function startJumpingMode() {
    if (!learnList || learnList.length === 0) return;
    
    // Đổi giao diện nút
    const btn = document.getElementById("btn-jumping-mode");
    if(btn) {
        btn.innerHTML = "⏹️ Dừng luyện tập";
        btn.style.background = "#fce7f3";
    }
    
    // Chạy logic nhảy với từ hiện tại của learnList
    runSmartJumpingLogic(() => learnList[learnIdx]);
}

// 2. Bắt đầu chế độ
function startReviewJumpingMode() {
    if (!reviewList || reviewList.length === 0) return;

    // Đổi giao diện nút
    const btn = document.getElementById("btn-review-jumping");
    if(btn) {
        btn.innerHTML = "⏹️ Dừng luyện tập";
        btn.style.background = "#fce7f3";
    }

    // Chạy logic nhảy với từ hiện tại của reviewList
    runSmartJumpingLogic(() => reviewList[currentReviewIdx]);
}

function runSmartJumpingLogic(getWordFunc) {
    isJumpingMode = true;

    // Mở Modal
    document.getElementById("auto-play-modal").style.display = "flex";
    
    // Reset thanh tiến độ
    let timeLeft = 30;
    const progressBar = document.getElementById("auto-play-progress");
    progressBar.style.width = "100%";

    // --- HÀM THỰC HIỆN 1 BƯỚC NHẢY ---
    const jumpAndSpeak = () => {
        if (!isJumpingMode) return;

        // 1. Lấy từ cần hiển thị (thông qua hàm callback)
        const w = getWordFunc(); 
        if (!w) return;

        // 2. Render lên thẻ
        const el = document.getElementById("jumping-word-el");
        document.getElementById("jump-word-text").textContent = w.word;
        document.getElementById("jump-word-mean").textContent = w.meaning;

        // 3. Tính vị trí ngẫu nhiên
        const area = document.getElementById("jumping-area");
        const maxX = area.clientWidth - el.offsetWidth - 20; 
        const maxY = area.clientHeight - el.offsetHeight - 20;
        const randX = Math.max(10, Math.floor(Math.random() * maxX));
        const randY = Math.max(10, Math.floor(Math.random() * maxY));

        el.style.left = randX + "px";
        el.style.top = randY + "px";

        // 4. PHÁT ÂM & ĐỢI (QUAN TRỌNG)
        // Thay vì dùng playPronunciation(), ta tự tạo Utterance để bắt sự kiện onend
        
        window.speechSynthesis.cancel(); // Dừng các âm thanh cũ
        currentUtterance = new SpeechSynthesisUtterance(w.word);
        currentUtterance.lang = "en-US";
        currentUtterance.rate = 0.9; // Đọc chậm một chút cho rõ
        const selectedVoiceName = localStorage.getItem("pref_voice");
        const selectedSpeed = localStorage.getItem("pref_speed") || 0.95;

        if (selectedVoiceName) {
        const voice = availableVoices.find(v => v.name === selectedVoiceName);
        if (voice) currentUtterance.voice = voice;
        currentUtterance.rate = selectedSpeed;
        }
        // KHI ĐỌC XONG -> Đợi 500ms rồi nhảy tiếp
        currentUtterance.onend = () => {
            if (isJumpingMode) {
                // Đệ quy: Gọi lại chính nó sau khi nghỉ 0.5s
                setTimeout(jumpAndSpeak, 500);
            }
        };

        // Xử lý lỗi nếu máy không đọc được -> Vẫn nhảy sau 2s
        currentUtterance.onerror = () => {
            if (isJumpingMode) setTimeout(jumpAndSpeak, 2000);
        };

        window.speechSynthesis.speak(currentUtterance);
    };

    // Bắt đầu nhảy phát đầu tiên
    jumpAndSpeak();

    // --- ĐẾM NGƯỢC THỜI GIAN TỔNG (30s) ---
    // Cái này chạy độc lập với việc nhảy
    countdownInterval = setInterval(() => {
        timeLeft--;
        const pct = (timeLeft / 30) * 100;
        progressBar.style.width = `${pct}%`;

        if (timeLeft <= 0) {
            stopJumpingMode();
            showToast("🏁 Hoàn thành bài luyện tập!", "success");
        }
    }, 1000);
}
// 3. Dừng chế độ
function stopJumpingMode() {
    isJumpingMode = false;
    
    // 1. Xóa bộ đếm
    clearInterval(jumpInterval);
    clearInterval(countdownInterval);
    
    // 2. Dừng âm thanh
    if (window.speechSynthesis) window.speechSynthesis.cancel();

    // 3. Đóng Modal
    document.getElementById("auto-play-modal").style.display = "none";

    // 4. RESET NÚT BẤM (Phần quan trọng để sửa lỗi của bạn)
    const btn = document.getElementById("btn-jumping-mode");
    if(btn) {
        btn.innerHTML = "⚡ Hack não từ này";
        btn.style.background = "#fdf4ff"; // Trả lại màu hồng nhạt
        btn.style.color = "#a21caf";
        btn.style.border = "1px solid #d946ef";
    }

    const btnReview = document.getElementById("btn-review-jumping");
    if(btnReview) {
        btnReview.innerHTML = "⚡ Hack não từ này";
        btnReview.style.background = "#fdf4ff";
    }
}

// 4. Tự động tắt khi chuyển Tab (Visibility API)
document.addEventListener("visibilitychange", () => {
    if (document.hidden && isJumpingMode) {
        stopJumpingMode();
        console.log("Tab ẩn -> Dừng luyện nghe.");
        stopAutoPlayPopup();
        showToast("Đã tạm dừng do chuyển tab.", "warning");
    }
});
function combineAndRenderWords() {
    
    // Cập nhật thống kê
    updateCount();
    
    // Render lại danh sách khóa học (Hệ thống)
    renderCourses();
    
    // Nếu đang ở màn hình danh sách từ thì vẽ lại
    const searchEl = document.getElementById("search-input");
    renderWords(searchEl ? searchEl.value : "");
}

function toggleReviewJumpingMode() {
    if (isJumpingMode) {
        stopJumpingMode();
    } else {
        startReviewJumpingMode();
    }
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
            fetchSystemWords(),
            fetchUserWords(),
            fetchIrregularVerbsFromSheet() // Tải sẵn cái này luôn cho nhanh
        ]);
        combineAndRenderWords();
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

