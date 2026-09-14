// 地方と都道府県の対応マッピング
const regionPrefMap = {
  hokkaido: ["北海道"],
  touhoku: ["青森県", "岩手県", "宮城県", "秋田県", "山形県", "福島県"],
  kanto: ["茨城県", "栃木県", "群馬県", "埼玉県", "千葉県", "東京都", "神奈川県"],
  chubu: ["新潟県", "富山県", "石川県", "福井県", "山梨県", "長野県", "岐阜県", "静岡県", "愛知県"],
  kansai: ["三重県", "滋賀県", "京都府", "大阪府", "兵庫県", "奈良県", "和歌山県"],
  chugoku: ["鳥取県", "島根県", "岡山県", "広島県", "山口県"],
  shikoku: ["徳島県", "香川県", "愛媛県", "高知県"],
  kyushu: ["福岡県", "佐賀県", "長崎県", "熊本県", "大分県", "宮崎県", "鹿児島県", "沖縄県"]
};

let rawSpotData = {}; // spots.json から非同期読み込み
let map;
let markers = {};
let selectedRoute = [];
let visitedStatus = {};
let currentActiveSpot = null;
let db;
let selectedPrefs = new Set();

const STORAGE_KEY_VISITED = 'pokefuta_visited_status';
const STORAGE_KEY_REGION = 'pokefuta_last_region';

// IndexedDBの初期化（画像保存用）
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("PokefutaPhotoDB", 1);
    request.onupgradeneeded = (e) => {
      db = e.target.result;
      if (!db.objectStoreNames.contains("photos")) {
        db.createObjectStore("photos", { keyPath: "id" });
      }
    };
    request.onsuccess = (e) => {
      db = e.target.result;
      resolve(db);
    };
    request.onerror = (e) => reject(e);
  });
}

// 写真保存
function savePhotoDB(id, dataUrl) {
  if (!db) return;
  const tx = db.transaction("photos", "readwrite");
  tx.objectStore("photos").put({ id: id, image: dataUrl });
}

// 写真取得
function getPhotoDB(id) {
  return new Promise((resolve) => {
    if (!db) return resolve(null);
    const tx = db.transaction("photos", "readonly");
    const request = tx.objectStore("photos").get(id);
    request.onsuccess = () => resolve(request.result ? request.result.image : null);
    request.onerror = () => resolve(null);
  });
}

function createIcon(colorHex) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" class="marker-pin"><path fill="${colorHex}" stroke="#FFFFFF" stroke-width="1.5" d="M12 0C5.373 0 0 5.373 0 12c0 9 12 24 12 24s12-15 12-24c0-6.627-5.373-12-12-12z"/><circle cx="12" cy="12" r="5" fill="#FFFFFF"/></svg>`;
  return L.divIcon({
    className: '',
    html: svg,
    iconSize: [24, 36],
    iconAnchor: [12, 36]
  });
}

const blueIcon = createIcon("#2563EB");  // 未訪問：青
const greenIcon = createIcon("#059669"); // 訪問済：緑

async function init() {
  await initDB();
  
  // ★spots.json の非同期取得（安全・エラー対策版）★
  try {
    const res = await fetch('./spots.json'); // 同階層を明示指定
    if (!res.ok) {
      throw new Error(`HTTPエラー Status: ${res.status}`);
    }
    rawSpotData = await res.json();
    console.log("spots.json 読み込み成功:", Object.keys(rawSpotData).length + " 地方のデータを読み込みました");
  } catch (err) {
    console.error("spots.json の読み込みに失敗しました:", err);
    alert("スポットデータの読み込みに失敗しました。ページを再読み込みしてください。");
  }

  loadSettings();

  map = L.map('map').setView([38.5, 140.5], 7);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.pref-dropdown')) {
      const dropdown = document.getElementById('prefDropdownContent');
      if (dropdown) dropdown.classList.remove('show');
    }
  });

  handleRegionChange(false);
  updateRouteUI();
}

function loadSettings() {
  const savedVisited = localStorage.getItem(STORAGE_KEY_VISITED);
  visitedStatus = savedVisited ? JSON.parse(savedVisited) : {};

  const savedRegion = localStorage.getItem(STORAGE_KEY_REGION);
  if (savedRegion) {
    const regionSelect = document.getElementById('regionSelect');
    if (regionSelect) regionSelect.value = savedRegion;
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY_VISITED, JSON.stringify(visitedStatus));
  const regionSelect = document.getElementById('regionSelect');
  if (regionSelect) {
    localStorage.setItem(STORAGE_KEY_REGION, regionSelect.value);
  }
}

function handleRegionChange(isUserAction) {
  const regionSelect = document.getElementById('regionSelect');
  if (!regionSelect) return;
  
  const region = regionSelect.value;
  const checkboxContainer = document.getElementById('prefCheckboxList');
  if (checkboxContainer) checkboxContainer.innerHTML = '';
  selectedPrefs.clear();

  let availablePrefs = [];
  if (region === 'all') {
    Object.values(regionPrefMap).forEach(prefs => availablePrefs.push(...prefs));
  } else if (regionPrefMap[region]) {
    availablePrefs = regionPrefMap[region];
  }

  if (checkboxContainer) {
    availablePrefs.forEach(pref => {
      selectedPrefs.add(pref);
      const label = document.createElement('label');
      label.className = 'pref-item';
      label.innerHTML = `
        <input type="checkbox" value="${pref}" checked onchange="handlePrefCheckboxChange()">
        <span>${pref}</span>
      `;
      checkboxContainer.appendChild(label);
    });
  }

  updatePrefDropdownBtnText();
  renderMarkers(isUserAction);
}

function togglePrefDropdown() {
  const dropdown = document.getElementById('prefDropdownContent');
  if (dropdown) dropdown.classList.toggle('show');
}

function handlePrefCheckboxChange() {
  const checkboxes = document.querySelectorAll('#prefCheckboxList input[type="checkbox"]');
  selectedPrefs.clear();
  checkboxes.forEach(cb => {
    if (cb.checked) selectedPrefs.add(cb.value);
  });

  updatePrefDropdownBtnText();
  renderMarkers(false);
}

function selectAllPrefs(selectAll) {
  const checkboxes = document.querySelectorAll('#prefCheckboxList input[type="checkbox"]');
  checkboxes.forEach(cb => {
    cb.checked = selectAll;
  });
  handlePrefCheckboxChange();
}

function updatePrefDropdownBtnText() {
  const btnText = document.getElementById('prefDropdownText');
  if (!btnText) return;
  
  const totalCount = document.querySelectorAll('#prefCheckboxList input[type="checkbox"]').length;
  
  if (selectedPrefs.size === 0) {
    btnText.innerText = "選択なし";
  } else if (selectedPrefs.size === totalCount) {
    btnText.innerText = "すべての県";
  } else {
    btnText.innerText = `${selectedPrefs.size}件 選択中`;
  }
}

function renderMarkers(isUserAction) {
  if (!map) return;
  
  const regionSelect = document.getElementById('regionSelect');
  const region = regionSelect ? regionSelect.value : 'all';
  const searchText = document.getElementById('pokemonSearch') ? document.getElementById('pokemonSearch').value.trim().toLowerCase() : '';

  // 既存ピンの消去
  Object.values(markers).forEach(m => map.removeLayer(m));
  markers = {};

  if (isUserAction) clearSelected();

  // ★データ未ロード安全対策★
  if (!rawSpotData || Object.keys(rawSpotData).length === 0) {
    console.warn("データがまだ読み込まれていません");
    return;
  }

  let targetSpots = [];
  if (region === 'all') {
    Object.values(rawSpotData).forEach(spots => {
      if (Array.isArray(spots)) targetSpots.push(...spots);
    });
  } else if (rawSpotData[region]) {
    targetSpots = rawSpotData[region];
  }

  // 二重フィルター（都道府県 ＆ ポケモン名）
  targetSpots = targetSpots.filter(spot => {
    const matchPref = Array.from(selectedPrefs).some(pref => spot.pref && spot.pref.includes(pref));
    const matchPokemon = searchText === '' || (spot.name && spot.name.toLowerCase().includes(searchText));
    return matchPref && matchPokemon;
  });

  if (targetSpots.length === 0) return;

  const bounds = [];
  targetSpots.forEach(spot => {
    const isVisited = visitedStatus[spot.id] || false;
    const isVisitedBool = typeof isVisited === 'object' ? isVisited.visited : !!isVisited;
    
    const marker = L.marker([spot.lat, spot.lng], {
      icon: isVisitedBool ? greenIcon : blueIcon
    }).addTo(map);
    
    marker.on('click', () => openModal(spot));
    
    markers[spot.id] = marker;
    bounds.push([spot.lat, spot.lng]);
  });

  if (bounds.length > 0) {
    map.fitBounds(bounds, { padding: [30, 30] });
  }
  if (isUserAction) saveSettings();
}

async function openModal(spot) {
  currentActiveSpot = spot;
  
  document.getElementById('modalTitle').innerText = spot.name;
  document.getElementById('modalPref').innerText = spot.pref;
  document.getElementById('modalOfficialLink').href = spot.officialUrl || "https://local.pokemon.jp/manhole/";

  const isVisited = visitedStatus[spot.id] || false;
  const isVisitedBool = typeof isVisited === 'object' ? isVisited.visited : !!isVisited;
  const vBtn = document.getElementById('modalVisitBtn');
  if (isVisitedBool) {
    vBtn.innerText = "✓ 訪問済";
    vBtn.className = "btn-modal btn-visited";
  } else {
    vBtn.innerText = "訪問済みにする";
    vBtn.className = "btn-modal btn-visit";
  }

  const savedPhoto = await getPhotoDB(spot.id);
  const imgEl = document.getElementById('photoImg');
  const placeholderEl = document.getElementById('photoPlaceholder');

  if (savedPhoto) {
    imgEl.src = savedPhoto;
    imgEl.style.display = 'block';
    placeholderEl.style.display = 'none';
  } else {
    imgEl.style.display = 'none';
    placeholderEl.style.display = 'block';
  }

  document.getElementById('photoModal').style.display = 'flex';
}

function closeModal() {
  document.getElementById('photoModal').style.display = 'none';
  currentActiveSpot = null;
}

function handlePhotoUpload(event) {
  const file = event.target.files[0];
  if (!file || !currentActiveSpot) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const dataUrl = e.target.result;
    
    const imgEl = document.getElementById('photoImg');
    const placeholderEl = document.getElementById('photoPlaceholder');
    imgEl.src = dataUrl;
    imgEl.style.display = 'block';
    placeholderEl.style.display = 'none';

    savePhotoDB(currentActiveSpot.id, dataUrl);
  };
  reader.readAsDataURL(file);
}

function toggleVisitedCurrent() {
  if (!currentActiveSpot) return;
  const id = currentActiveSpot.id;
  const todayKey = new Date().toISOString().slice(0, 10);
  
  const currentVal = visitedStatus[id];
  const isCurrentlyVisited = typeof currentVal === 'object' ? currentVal.visited : !!currentVal;

  if (!isCurrentlyVisited) {
    visitedStatus[id] = { visited: true, date: todayKey };
  } else {
    visitedStatus[id] = { visited: false, date: todayKey };
  }

  const isVisited = visitedStatus[id].visited;

  if (markers[id]) {
    markers[id].setIcon(isVisited ? greenIcon : blueIcon);
  }

  const vBtn = document.getElementById('modalVisitBtn');
  if (isVisited) {
    vBtn.innerText = "✓ 訪問済";
    vBtn.className = "btn-modal btn-visited";
  } else {
    vBtn.innerText = "未訪問にする";
    vBtn.className = "btn-modal btn-visit";
  }

  saveSettings();
}

function addToRouteCurrent() {
  if (!currentActiveSpot) return;
  addToRoute(currentActiveSpot);
  closeModal();
}

function addToRoute(spot) {
  if (!selectedRoute.some(s => s.id === spot.id)) {
    selectedRoute.push(spot);
    updateRouteUI();
  }
}

function moveRouteItem(index, direction) {
  const targetIndex = index + direction;
  if (targetIndex < 0 || targetIndex >= selectedRoute.length) return;
  
  const temp = selectedRoute[index];
  selectedRoute[index] = selectedRoute[targetIndex];
  selectedRoute[targetIndex] = temp;
  
  updateRouteUI();
}

function removeRouteItem(index) {
  selectedRoute.splice(index, 1);
  updateRouteUI();
}

function updateRouteUI() {
  const listEl = document.getElementById('routeList');
  const navBtn = document.getElementById('navBtn');

  if (selectedRoute.length === 0) {
    listEl.innerHTML = '<li style="color:#9ca3af; font-size:12px; text-align:center; padding:12px 8px;">マップ上のピンをタップし「ルートに追加」してください。</li>';
    navBtn.disabled = true;
    return;
  }

  listEl.innerHTML = '';
  selectedRoute.forEach((spot, idx) => {
    const li = document.createElement('li');
    li.className = 'route-item';
    li.innerHTML = `
      <div style="display:flex; align-items:center; overflow:hidden;">
        <span class="badge">${idx + 1}</span>
        <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          <div style="font-weight:bold; overflow:hidden; text-overflow:ellipsis;">${spot.name}</div>
          <div style="font-size:11px; color:#6b7280;">${spot.pref}</div>
        </div>
      </div>
      <div class="item-actions">
        <button class="btn-action" onclick="moveRouteItem(${idx}, -1)" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="btn-action" onclick="moveRouteItem(${idx}, 1)" ${idx === selectedRoute.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="btn-action btn-delete" onclick="removeRouteItem(${idx})">✕</button>
      </div>
    `;
    listEl.appendChild(li);
  });

  navBtn.disabled = false;
}

function clearSelected() {
  selectedRoute = [];
  updateRouteUI();
}

function openGoogleMaps() {
  if (selectedRoute.length === 0) return;

  const mode = document.querySelector('input[name="routeMode"]:checked').value;
  const lastSpot = selectedRoute[selectedRoute.length - 1];
  const destination = `${lastSpot.lat},${lastSpot.lng}`;

  let url = '';

  if (mode === 'current') {
    let waypoints = '';
    if (selectedRoute.length > 1) {
      const waypointsList = selectedRoute.slice(0, -1);
      waypoints = '&waypoints=' + waypointsList.map(s => `${s.lat},${s.lng}`).join('|');
    }
    url = `https://www.google.com/maps/dir/?api=1&destination=${destination}${waypoints}&travelmode=driving`;

  } else {
    const firstSpot = selectedRoute[0];
    const origin = `${firstSpot.lat},${firstSpot.lng}`;

    let waypoints = '';
    if (selectedRoute.length > 2) {
      const waypointsList = selectedRoute.slice(1, -1);
      waypoints = '&waypoints=' + waypointsList.map(s => `${s.lat},${s.lng}`).join('|');
    }
    url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypoints}&travelmode=driving`;
  }

  window.open(url, '_blank');
}

async function exportBackupData() {
  if (!db) {
    alert("データベース準備中です。少し待ってから再試行してください。");
    return;
  }

  const photos = await new Promise((resolve) => {
    const tx = db.transaction("photos", "readonly");
    const request = tx.objectStore("photos").getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => resolve([]);
  });

  const backupObj = {
    version: 1,
    exportedAt: new Date().toISOString(),
    visitedStatus: visitedStatus,
    lastRegion: document.getElementById('regionSelect').value,
    photos: photos
  };

  const jsonStr = JSON.stringify(backupObj);
  const blob = new Blob([jsonStr], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `pokefuta_backup_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importBackupData(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = JSON.parse(e.target.result);

      if (!data.visitedStatus) {
        alert("無効なバックアップファイルです。");
        return;
      }

      if (!confirm("現在の保存データが上書きされます。復元を実行しますか？")) {
        return;
      }

      visitedStatus = data.visitedStatus || {};
      saveSettings();

      if (data.photos && Array.isArray(data.photos) && db) {
        const tx = db.transaction("photos", "readwrite");
        const store = tx.objectStore("photos");
        store.clear();
        data.photos.forEach(p => store.put(p));
      }

      handleRegionChange(false);
      alert("データの復元が完了しました！");
    } catch (err) {
      alert("ファイルの読み込みエラーが発生しました。");
      console.error(err);
    }
  };
  reader.readAsText(file);
  event.target.value = "";
}

function updateCardMemo() {
  const memoInput = document.getElementById('shareMemoInput');
  const memoText = memoInput ? memoInput.value.trim() : '';
  const memoEl = document.getElementById('shareCardMemo');
  
  if (memoEl) {
    if (memoText) {
      memoEl.innerText = '“ ' + memoText + ' ”';
      memoEl.style.display = 'block';
    } else {
      memoEl.innerText = '';
      memoEl.style.display = 'none';
    }
  }
}

async function openShareModal() {
  const today = new Date();
  const todayStr = today.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' });
  const todayKey = today.toISOString().slice(0, 10);
  
  document.getElementById('shareCardDate').innerText = todayStr;
  
  if (document.getElementById('shareMemoInput')) {
    document.getElementById('shareMemoInput').value = '';
  }
  const memoEl = document.getElementById('shareCardMemo');
  if (memoEl) {
    memoEl.innerText = '';
    memoEl.style.display = 'none';
  }

  const contentArea = document.getElementById('shareCardContent');
  contentArea.innerHTML = '<div style="text-align:center; padding:10px; color:#666;">データを読み込み中...</div>';
  
  let todaySpots = [];
  let todayPhotos = [];

  try {
    for (const regionKey in rawSpotData) {
      const spots = rawSpotData[regionKey];
      if (Array.isArray(spots)) {
        for (const spot of spots) {
          const status = visitedStatus[spot.id];
          
          if (status) {
            const isVisited = typeof status === 'object' ? status.visited : !!status;
            const visitDate = typeof status === 'object' ? status.date : todayKey;

            if (isVisited && visitDate === todayKey) {
              const photoData = await getPhotoDB(spot.id);
              if (photoData) {
                todayPhotos.push({ name: spot.name, img: photoData });
              }
              todaySpots.push(spot.name);
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("データ取得エラー:", e);
  }

  contentArea.innerHTML = '';

  if (todayPhotos.length > 0) {
    const grid = document.createElement('div');
    grid.className = 'card-grid';
    
    todayPhotos.forEach(item => {
      const imgWrap = document.createElement('div');
      imgWrap.style.position = 'relative';
      imgWrap.innerHTML = 
        '<img src="' + item.img + '" class="card-img-item">' +
        '<div style="position:absolute; bottom:2px; left:2px; background:rgba(0,0,0,0.6); color:#fff; font-size:9px; padding:2px 4px; border-radius:3px; max-width:90%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">' +
          item.name +
        '</div>';
      grid.appendChild(imgWrap);
    });
    contentArea.appendChild(grid);

  } else if (todaySpots.length > 0) {
    let listHtml = '<div style="padding: 10px; background: #fff; border-radius: 6px; font-size: 13px; color: #334155; width: 100%; box-sizing: border-box;">' +
      '<b style="display: block; width: 100%; white-space: nowrap;">📍 本日訪問したポケふた (' + todaySpots.length + '箇所)</b>' +
      '<ul style="margin: 6px 0 0 18px; padding: 0; width: 100%;">';
    
    todaySpots.forEach(name => {
      listHtml += '<li style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; margin-bottom: 2px;">' + name + '</li>';
    });
    listHtml += '</ul></div>';
    contentArea.innerHTML = listHtml;

  } else {
    contentArea.innerHTML = '<div style="padding:15px; text-align:center; color:#64748b; font-size:13px;">本日訪問済みにしたポケふたがありません。<br>マップ上のポケふたを「訪問済み」にするとここに表示されます！</div>';
  }

  document.getElementById('shareCardCount').innerText = '本日訪問: ' + todaySpots.length + '箇所';
  document.getElementById('shareModal').style.display = 'flex';
}

function closeShareModal() {
  const modal = document.getElementById('shareModal');
  const preview = document.getElementById('previewArea');
  if (modal) modal.style.display = 'none';
  if (preview) preview.style.display = 'none';
}

function generateCardImage() {
  const cardElem = document.getElementById('shareCard');
  html2canvas(cardElem, { scale: 2, useCORS: true }).then(canvas => {
    const imgData = canvas.toDataURL('image/png');
    const imgElem = document.getElementById('generatedImg');
    imgElem.src = imgData;
    document.getElementById('previewArea').style.display = 'block';
  });
}

function postToX() {
  const countText = document.getElementById('shareCardCount').innerText;
  const memoInput = document.getElementById('shareMemoInput');
  const memoText = memoInput ? memoInput.value.trim() : '';
  const memoFormatted = memoText ? '\n💬 ' + memoText + '\n' : '';
  
  const text = encodeURIComponent('今日のポケふた巡り完了！\n' + countText + '！📸' + memoFormatted + '\n#ポケふた #ポケふたナビ\n');
  const url = encodeURIComponent('https://akabixi.github.io/pokelid_navi.ver1.01/');
  window.open('https://x.com/intent/tweet?text=' + text + '&url=' + url, '_blank');
}

window.onload = init;
