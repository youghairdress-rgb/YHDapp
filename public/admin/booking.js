import { runAdminPage } from './admin-auth.js';
import { db, storage } from './firebase-init.js';
import {
  collection,
  getDocs,
  onSnapshot,
  addDoc,
  doc,
  setDoc,
  deleteDoc,
  query,
  where,
  Timestamp,
  orderBy,
  getDoc,
  serverTimestamp,
  collectionGroup,
  writeBatch,
} from 'firebase/firestore';
import {
  ref,
  uploadBytes,
  getDownloadURL
} from 'firebase/storage';

const bookingMain = async (auth, user) => {
  // DOM Elements
  const calendarMonthEl = document.getElementById('calendar-month');
  const calendarGridEl = document.getElementById('calendar-grid');
  const prevMonthBtn = document.getElementById('prev-month');
  const nextMonthBtn = document.getElementById('next-month');
  const timelineDateEl = document.getElementById('timeline-date');
  const timelineSlotsEl = document.getElementById('timeline-slots');
  const timelineHoursEl = document.querySelector('.timeline-hours');
  const dailyMemoEl = document.getElementById('daily-memo');
  const timelineWrapper = document.querySelector('.timeline-wrapper');
  const consultationCard = document.getElementById('consultation-card');
  const consultationList = document.getElementById('consultation-list');

  // Modals
  const detailModal = document.getElementById('booking-detail-modal');
  const actionModal = document.getElementById('timeslot-action-modal');
  const editModal = document.getElementById('booking-edit-modal');

  // Edit Modal Form Fields
  const bookingForm = document.getElementById('booking-form');
  const editModalTitle = document.getElementById('edit-modal-title');
  const customerInput = document.getElementById('customer-input');
  const customerDatalist = document.getElementById('customer-datalist');
  const menuAccordionContainer = document.getElementById('menu-accordion-container');
  const startTimeSelect = document.getElementById('start-time');
  const endTimeSelect = document.getElementById('end-time');
  const deleteBtn = document.getElementById('delete-booking-btn');
  const newCustomerFields = document.getElementById('new-customer-fields');
  const newCustomerKanaInput = document.getElementById('new-customer-kana');
  const newCustomerPhoneInput = document.getElementById('new-customer-phone');
  const adminNotesInput = document.getElementById('admin-notes');

  // ★★★ 予約不可モーダル関連 ★★★
  const unavailableModal = document.getElementById('unavailable-modal');
  const unavailableForm = document.getElementById('unavailable-form');
  const unavailableStartTimeSelect = document.getElementById('unavailable-start-time');
  const unavailableEndTimeSelect = document.getElementById('unavailable-end-time');
  const unavailableTitle = document.getElementById('unavailable-modal-title');

  // AI Action Elements
  const detailCameraBtn = document.getElementById('detail-camera-btn');
  const detailMobileUploadLink = document.getElementById('detail-mobile-upload-link');
  const detailHairAppCameraLink = document.getElementById('detail-hair-upload-link');
  const detailMatchingCameraLink = document.getElementById('detail-matching-camera-link');
  const detailPromptGeneratorLink = document.getElementById('detail-prompt-generator-link');
  const detailCounselingLink = document.getElementById('detail-counseling-link');
  const detailHairAppEditLink = document.getElementById('detail-hair-edit-link');
  const detailMatchingResultLink = document.getElementById('detail-matching-result-link');
  const photoUploadInput = document.getElementById('photo-upload-input');

  // State
  let salonSettings = {};
  let currentDate = new Date();
  let selectedDate = new Date();
  selectedDate.setHours(0, 0, 0, 0);
  let customers = [];
  let menuCategories = [];
  let editingBooking = null;
  let reservations = []; // クロージャスコープに移動
  let unsubscribeReservations = null;
  // ▼▼▼ 修正: 8:00～22:00（14時間） ▼▼▼
  const fixedStartHour = 8;
  const fixedEndHour = 22;
  // ▲▲▲ 修正ここまで ▲▲▲

  const openModal = (modal) => {
    document.body.classList.add('modal-open');
    modal.style.display = 'flex';
  };
  const closeModal = (modal) => {
    document.body.classList.remove('modal-open');
    modal.style.display = 'none';
  };

  const loadSalonSettings = async () => {
    const docRef = doc(db, 'settings', 'salon');
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      salonSettings = docSnap.data();
    } else {
      console.log('サロン設定が見つかりません。デフォルト値を使用します。');
      salonSettings = {
        businessHours: {
          0: { isOpen: true, start: '10:00', end: '20:00' },
          1: { isOpen: true, start: '10:00', end: '20:00' },
          2: { isOpen: true, start: '10:00', end: '20:00' },
          3: { isOpen: true, start: '10:00', end: '20:00' },
          4: { isOpen: true, start: '10:00', end: '20:00' },
          5: { isOpen: true, start: '10:00', end: '20:00' },
          6: { isOpen: true, start: '10:00', end: '20:00' },
        },
      };
    }
  };

  const renderCalendar = async () => {
    currentDate.setDate(1);
    const month = currentDate.getMonth();
    const year = currentDate.getFullYear();
    calendarMonthEl.textContent = `${year}年 ${month + 1}月`;

    const firstDayOfMonth = new Date(year, month, 1);
    const lastDayOfMonth = new Date(year, month + 1, 0);

    const startOfMonth = Timestamp.fromDate(firstDayOfMonth);
    const endOfMonth = Timestamp.fromDate(new Date(year, month + 1, 1));
    const q = query(
      collection(db, 'reservations'),
      where('startTime', '>=', startOfMonth),
      where('startTime', '<', endOfMonth)
    );
    const snapshot = await getDocs(q);
    const bookingCounts = {};
    snapshot.forEach((doc) => {
      // ▼▼▼ 修正: 予約不可を除外 ▼▼▼
      const data = doc.data();
      if (data.status !== 'unavailable') {
        const date = data.startTime.toDate().getDate();
        bookingCounts[date] = (bookingCounts[date] || 0) + 1;
      }
      // ▲▲▲ 修正ここまで ▲▲▲
    });

    calendarGridEl.innerHTML = '';
    const startDay = firstDayOfMonth.getDay();
    for (let i = 0; i < startDay; i++) {
      calendarGridEl.innerHTML += '<div></div>';
    }

    for (let i = 1; i <= lastDayOfMonth.getDate(); i++) {
      const dayCell = document.createElement('div');
      dayCell.className = 'calendar-day';
      const date = new Date(year, month, i);

      let html = `<span>${i}</span>`;
      if (bookingCounts[i]) {
        html += `<span class="booking-count">${bookingCounts[i]}</span>`;
      } else {
        html += `<span class="booking-count" style="visibility: hidden;">0</span>`;
      }
      dayCell.innerHTML = html;
      const dateString = `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
      dayCell.dataset.date = dateString;

      const dayOfWeek = date.getDay();
      const daySetting = salonSettings.businessHours
        ? salonSettings.businessHours[dayOfWeek]
        : { isOpen: true };
      if (
        !daySetting.isOpen ||
        (salonSettings.specialHolidays && salonSettings.specialHolidays.includes(dateString))
      ) {
        dayCell.classList.add('holiday');
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (date.getTime() === today.getTime()) {
        dayCell.classList.add('today');
      }

      if (date.getTime() === selectedDate.getTime()) {
        dayCell.classList.add('selected');
      }

      dayCell.addEventListener('click', (e) => {
        const dateStr = e.currentTarget.dataset.date;
        selectedDate = new Date(dateStr);
        selectedDate.setHours(0, 0, 0, 0);
        renderCalendar(); // カレンダーを再描画して選択状態を更新
        listenToReservations(); // タイムラインを更新
        loadDailyMemo(); // メモを更新
      });
      calendarGridEl.appendChild(dayCell);
    }
  };

  const renderTimeline = (reservations) => {
    timelineDateEl.textContent = `${selectedDate.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' })}`;

    const normalReservations = reservations.filter(
      (r) => !r.isConsultation && r.status !== 'unavailable'
    );
    const unavailableSlots = reservations.filter((r) => r.status === 'unavailable');
    const consultationRequests = reservations.filter((r) => r.isConsultation);

    timelineSlotsEl.innerHTML = '';

    // ▼▼▼ 修正: 8:00～22:00（14時間）で描画 ▼▼▼
    timelineHoursEl.innerHTML = '';
    const totalHours = fixedEndHour - fixedStartHour; // 14
    const timelineHeight = totalHours * 120 + 20; // 1時間120px + オフセット
    timelineWrapper.style.height = `${timelineHeight}px`;

    for (let h = fixedStartHour; h <= fixedEndHour; h++) {
      const top = (h - fixedStartHour) * 120; // 8時を0として計算

      const border = document.createElement('div');
      border.className = 'timeline-border';
      border.style.top = `${top}px`;
      timelineSlotsEl.appendChild(border);

      const hourLabel = document.createElement('div');
      hourLabel.className = 'timeline-hour-label';
      hourLabel.textContent = `${h}:00`;
      hourLabel.style.top = `${top}px`;
      timelineHoursEl.appendChild(hourLabel);

      if (h < fixedEndHour) {
        const borderHalf = document.createElement('div');
        borderHalf.className = 'timeline-border-half';
        borderHalf.style.top = `${top + 60}px`;
        timelineSlotsEl.appendChild(borderHalf);
      }
    }

    // 営業時間マーカーの描画
    const dayOfWeek = selectedDate.getDay();
    const todaySettings = salonSettings.businessHours
      ? salonSettings.businessHours[dayOfWeek]
      : null;
    if (todaySettings && todaySettings.isOpen) {
      const [startH, startM] = todaySettings.start.split(':').map(Number);
      const [endH, endM] = todaySettings.end.split(':').map(Number);

      const startMinutes = startH * 60 + startM - fixedStartHour * 60;
      const endMinutes = endH * 60 + endM - fixedStartHour * 60;

      const startMarker = document.createElement('div');
      startMarker.className = 'business-hours-marker-v';
      startMarker.style.top = `${startMinutes * 2}px`;
      timelineSlotsEl.appendChild(startMarker);

      const endMarker = document.createElement('div');
      endMarker.className = 'business-hours-marker-v';
      endMarker.style.top = `${endMinutes * 2}px`;
      timelineSlotsEl.appendChild(endMarker);
    }
    // ▲▲▲ 修正ここまで ▲▲▲

    // ▼▼▼ 修正: 重複レイアウト計算 ▼▼▼
    const sortedReservations = [...normalReservations, ...unavailableSlots].sort(
      (a, b) => a.startTime.toDate() - b.startTime.toDate()
    );

    // レイアウト計算用の変数
    const clusters = [];
    let currentCluster = [];
    let clusterEndTime = 0;

    sortedReservations.forEach((res) => {
      const start = res.startTime.toDate().getTime();
      const end = res.endTime.toDate().getTime();

      if (currentCluster.length === 0) {
        currentCluster.push(res);
        clusterEndTime = end;
      } else {
        if (start < clusterEndTime) {
          currentCluster.push(res);
          if (end > clusterEndTime) clusterEndTime = end;
        } else {
          clusters.push(currentCluster);
          currentCluster = [res];
          clusterEndTime = end;
        }
      }
    });
    if (currentCluster.length > 0) clusters.push(currentCluster);

    clusters.forEach((cluster) => {
      const lanes = [];
      cluster.forEach((res) => {
        const start = res.startTime.toDate().getTime();
        const end = res.endTime.toDate().getTime();
        let laneIndex = 0;
        while (true) {
          if (!lanes[laneIndex]) {
            lanes[laneIndex] = end;
            res.lane = laneIndex;
            break;
          } else {
            if (start >= lanes[laneIndex]) {
              lanes[laneIndex] = end;
              res.lane = laneIndex;
              break;
            } else {
              laneIndex++;
            }
          }
        }
      });

      const maxLanes = lanes.length;

      cluster.forEach((res) => {
        const start = res.startTime.toDate();
        const end = res.endTime.toDate();

        const startMinutes = start.getHours() * 60 + start.getMinutes();
        const endMinutes = end.getHours() * 60 + end.getMinutes();
        const duration = endMinutes - startMinutes;

        // 8時を0として計算
        const top = (startMinutes - fixedStartHour * 60) * 2;
        const height = duration * 2;

        const resElement = document.createElement('div');
        resElement.className = 'reservation-item';
        resElement.style.top = `${top}px`;
        resElement.style.height = `${height}px`;

        // booking.htmlは縦軸が時間、横軸が列なので、幅を分割する
        const widthPercent = 100 / maxLanes;
        const leftPercent = res.lane * widthPercent;

        resElement.style.width = `${widthPercent}%`;
        resElement.style.left = `${leftPercent}%`;
        resElement.style.right = 'auto'; // CSSのright: 10pxを無効化

        // スタイル調整: 重なっている場合はボーダーなどで区切りを見やすく
        if (maxLanes > 1) {
          resElement.style.borderLeft = '1px solid white';
          resElement.style.borderRight = '1px solid white';
        }

        if (res.status === 'unavailable') {
          resElement.classList.add('unavailable');
        }
        if (res.status === 'completed') {
          resElement.classList.add('completed');
        }

        const menuNames =
          res.selectedMenus && Array.isArray(res.selectedMenus)
            ? res.selectedMenus.map((m) => m.name).join(', ')
            : res.status === 'unavailable'
              ? '予約不可'
              : 'メニュー情報なし';

        const customer = customers.find((c) => c.id === res.customerId);
        const lineIcon =
          customer && customer.isLineUser ? '<i class="fa-brands fa-line line-icon"></i>' : '';
        const noteIcon =
          customer && customer.notes
            ? '<i class="fa-solid fa-triangle-exclamation note-icon"></i>'
            : '';

        let innerHtml = `<strong>${lineIcon}<span class="reservation-item-name">${res.customerName || ''}</span>${noteIcon}</strong>`;

        // 幅が狭い・高さが低い場合は簡略表示
        if (maxLanes <= 2 && height >= 40) {
          innerHtml += `<small>${start.getHours()}:${String(start.getMinutes()).padStart(2, '0')} - ${end.getHours()}:${String(end.getMinutes()).padStart(2, '0')}</small>`;
          innerHtml += `<small class="menu-names">${menuNames}</small>`;
          if (res.adminNotes) {
            innerHtml += `<small class="admin-notes-preview" style="display:block; color:var(--accent-color); overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">📝 ${res.adminNotes}</small>`;
          }
        }

        resElement.innerHTML = innerHtml;

        resElement.addEventListener('click', (e) => {
          e.stopPropagation();
          openDetailModal(res);
        });
        timelineSlotsEl.appendChild(resElement);
      });
    });
    // ▲▲▲ 修正ここまで ▲▲▲

    if (consultationRequests.length > 0) {
      consultationList.innerHTML = '';
      consultationRequests.forEach((res) => {
        const li = document.createElement('li');
        li.className = 'consultation-item';
        li.innerHTML = `<strong>${res.customerName}</strong><span>${res.userRequests || 'ご要望なし'}</span>`;
        li.addEventListener('click', () => openDetailModal(res));
        consultationList.appendChild(li);
      });
      consultationCard.style.display = 'block';
    } else {
      consultationCard.style.display = 'none';
    }
  };

  const openDetailModal = (booking) => {
    editingBooking = booking;
    const detailModalTitle = document.getElementById('detail-modal-title');
    const normalActions = document.getElementById('normal-booking-actions');
    const unavailableActions = document.getElementById('unavailable-booking-actions');
    const requestsWrapper = document.getElementById('detail-requests-wrapper');
    const requestsEl = document.getElementById('detail-requests');
    const adminNotesWrapper = document.getElementById('detail-admin-notes-wrapper');
    const adminNotesEl = document.getElementById('detail-admin-notes');

    if (booking.status === 'unavailable') {
      detailModalTitle.textContent = '予約不可設定';
      document.getElementById('normal-booking-details').style.display = 'none';
      if (normalActions) normalActions.style.display = 'none';
      if (unavailableActions) unavailableActions.style.display = 'block';
    } else {
      document.getElementById('normal-booking-details').style.display = 'block';
      detailModalTitle.textContent = '予約詳細';
      document.getElementById('detail-customer-name').textContent = booking.customerName || 'N/A';
      const start = booking.startTime.toDate();
      const end = booking.endTime.toDate();

      if (booking.isConsultation) {
        document.getElementById('detail-datetime').textContent = '時間未定（相談中）';
      } else {
        document.getElementById('detail-datetime').textContent =
          `${start.toLocaleString('ja-JP', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })} - ${end.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}`;
      }

      if (booking.userRequests) {
        requestsEl.textContent = booking.userRequests;
        requestsWrapper.style.display = 'block';
      } else {
        requestsWrapper.style.display = 'none';
      }

      if (booking.adminNotes) {
        adminNotesEl.textContent = booking.adminNotes;
        adminNotesWrapper.style.display = 'block';
      } else {
        adminNotesWrapper.style.display = 'none';
      }

      document.getElementById('detail-menus').textContent =
        booking.selectedMenus?.map((m) => m.name).join(', ') || 'N/A';
      if (normalActions) normalActions.style.display = 'grid';
      if (unavailableActions) unavailableActions.style.display = 'none';

      const posLink = document.getElementById('detail-pos-link');
      if (booking.status === 'completed') {
        posLink.style.display = 'none';
      } else {
        posLink.style.display = 'flex';
        posLink.href = `./pos.html?bookingId=${booking.id}`;
      }
      const customerNameEncoded = encodeURIComponent(booking.customerName);
      document.getElementById('detail-customer-link').href =
        `/admin/customers.html?customerId=${booking.customerId}&customerName=${customerNameEncoded}`;

      // AI Action Links Logic (すべてルート相対パスかつ動的パラメータ付き)

      // 画像素材アップロード
      if (detailMobileUploadLink) {
        detailMobileUploadLink.href = `/diagnosis/mobile_upload.html?customerId=${booking.customerId}&customerName=${customerNameEncoded}`;
      }

      // 髪色アプリ (撮影)
      if (detailHairAppCameraLink) {
        detailHairAppCameraLink.href = `/hair_upload.html?customerId=${booking.customerId}&customerName=${customerNameEncoded}`;
      }

      // マッチングアプリ (camera)
      if (detailMatchingCameraLink) {
        detailMatchingCameraLink.href = `/ai-matching/camera.html?customerId=${booking.customerId}&customerName=${customerNameEncoded}`;
      }

      // プロンプトジェネレーター
      if (detailPromptGeneratorLink) {
        detailPromptGeneratorLink.href = `/prompt-generator/index.html?customerId=${booking.customerId}&customerName=${customerNameEncoded}`;
      }

      // Helper for fullscreen popup
      const openFullscreen = (url) => {
        window.open(url, '_blank', `toolbar=no,location=no,status=no,menubar=no,scrollbars=yes,resizable=yes,width=${screen.availWidth},height=${screen.availHeight}`);
      };

      // AIカウンセリング (診断)
      if (detailCounselingLink) {
        detailCounselingLink.onclick = (e) => {
          e.preventDefault();
          openFullscreen(`/diagnosis/index.html?customerId=${booking.customerId}&customerName=${customerNameEncoded}`);
        };
      }

      // 髪色アプリ (編集)
      if (detailHairAppEditLink) {
        detailHairAppEditLink.onclick = (e) => {
          e.preventDefault();
          openFullscreen(`/hair_transform.html?customerId=${booking.customerId}&customerName=${customerNameEncoded}`);
        };
      }

      // マッチングアプリ (result)
      if (detailMatchingResultLink) {
        detailMatchingResultLink.onclick = (e) => {
          e.preventDefault();
          openFullscreen(`/ai-matching/result.html?customerId=${booking.customerId}&customerName=${customerNameEncoded}`);
        };
      }
    }
    openModal(detailModal);
  };

  const openActionModal = (time) => {
    document.getElementById('timeslot-action-title').textContent =
      `${selectedDate.toLocaleDateString('ja-JP')} ${time}`;
    document.getElementById('action-add-booking').onclick = () => {
      closeModal(actionModal);
      openEditModal(time);
    };
    // ▼▼▼ 修正: 予約不可モーダルを開くように変更 ▼▼▼
    document.getElementById('action-set-unavailable').onclick = async () => {
      closeModal(actionModal);
      openUnavailableModal(time);
    };
    // ▲▲▲ 修正ここまで ▲▲▲
    openModal(actionModal);
  };

  // ★★★ 予約不可モーダルを開く関数 ★★★
  const openUnavailableModal = (time) => {
    unavailableForm.reset();
    unavailableTitle.textContent = `予約不可設定 (${selectedDate.toLocaleDateString('ja-JP')})`;
    unavailableStartTimeSelect.value = time;
    // デフォルトで30分後の時刻を終了時刻に設定
    const [h, m] = time.split(':').map(Number);
    const startDate = new Date(selectedDate);
    startDate.setHours(h, m, 0, 0);
    const endDate = new Date(startDate.getTime() + 30 * 60000);
    const endTime = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;

    // 終了時刻が22:00を超える場合は22:00に設定
    if (
      endDate.getHours() > fixedEndHour ||
      (endDate.getHours() === fixedEndHour && endDate.getMinutes() > 0)
    ) {
      unavailableEndTimeSelect.value = `${String(fixedEndHour).padStart(2, '0')}:00`;
    } else {
      unavailableEndTimeSelect.value = endTime;
    }

    openModal(unavailableModal);
  };

  // ★★★ 予約不可を保存する関数 ★★★
  const saveUnavailable = async (e) => {
    e.preventDefault();
    const startTimeStr = unavailableStartTimeSelect.value;
    const endTimeStr = unavailableEndTimeSelect.value;

    const [startH, startM] = startTimeStr.split(':').map(Number);
    const startTime = new Date(selectedDate);
    startTime.setHours(startH, startM, 0, 0);

    const [endH, endM] = endTimeStr.split(':').map(Number);
    const endTime = new Date(selectedDate);
    endTime.setHours(endH, endM, 0, 0);

    if (endTime <= startTime) {
      alert('終了時間は開始時間より後に設定してください。');
      return;
    }

    const data = {
      startTime: Timestamp.fromDate(startTime),
      endTime: Timestamp.fromDate(endTime),
      status: 'unavailable',
      customerName: '予約不可',
      customerId: null,
      selectedMenus: [],
      isConsultation: false,
      createdAt: serverTimestamp(),
      createdBy: 'admin',
    };

    try {
      await addDoc(collection(db, 'reservations'), data);
      closeModal(unavailableModal);
    } catch (error) {
      console.error('予約不可設定の追加に失敗:', error);
      alert('予約不可設定の追加に失敗しました。');
    }
  };

  // ★★★ 終了時刻を自動計算する関数 ★★★
  const calculateEndTime = () => {
    const selectedMenuCheckboxes = menuAccordionContainer.querySelectorAll('input:checked');
    const allMenus = menuCategories.flatMap((cat) => cat.menus);
    const selectedMenus = Array.from(selectedMenuCheckboxes)
      .map((cb) => {
        return allMenus.find((m) => m.id === cb.value);
      })
      .filter(Boolean); // filter(Boolean) で undefined を除外

    const totalDuration = selectedMenus.reduce((sum, menu) => sum + menu.duration, 0);

    const startTimeStr = startTimeSelect.value;
    if (!startTimeStr) return;

    const [startH, startM] = startTimeSelect.value.split(':').map(Number);
    const startDate = new Date(selectedDate);
    startDate.setHours(startH, startM, 0, 0);

    const endDate = new Date(startDate.getTime() + totalDuration * 60000);

    // 30分単位で切り上げ
    const endMinutesTotal = endDate.getHours() * 60 + endDate.getMinutes();
    const roundedEndMinutes = Math.ceil(endMinutesTotal / 30) * 30;
    const endH = Math.floor(roundedEndMinutes / 60);
    const endM = roundedEndMinutes % 60;

    const endTimeStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

    // 終了時刻が22:00を超える場合は22:00に設定
    if (endH > fixedEndHour || (endH === fixedEndHour && endM > 0)) {
      endTimeSelect.value = `${String(fixedEndHour).padStart(2, '0')}:00`;
    } else if (endTimeSelect.querySelector(`option[value="${endTimeStr}"]`)) {
      endTimeSelect.value = endTimeStr;
    } else {
      // 該当するoptionがない場合 (例: 22:00を超える場合など)
      endTimeSelect.value = endTimeSelect.options[endTimeSelect.options.length - 1].value;
    }
  };

  const openEditModal = (timeOrBooking) => {
    bookingForm.reset();
    customerInput.value = '';
    deleteBtn.style.display = 'none';
    newCustomerFields.style.display = 'none';
    newCustomerKanaInput.required = false;
    adminNotesInput.value = '';

    menuAccordionContainer
      .querySelectorAll('input[type="checkbox"]')
      .forEach((cb) => (cb.checked = false));

    // populateTimeSelects(); // loadInitialDataForModalsで実行済みにする

    if (typeof timeOrBooking === 'string') {
      editingBooking = null;
      editModalTitle.textContent = '新規予約追加';
      startTimeSelect.value = timeOrBooking;
      endTimeSelect.value = timeOrBooking;
      customerInput.disabled = false;
    } else {
      editingBooking = timeOrBooking;
      editModalTitle.textContent = '予約編集';

      customerInput.value = editingBooking.customerName;
      customerInput.disabled = true;

      if (editingBooking.selectedMenus) {
        editingBooking.selectedMenus.forEach((menu) => {
          const checkbox = menuAccordionContainer.querySelector(`input[value="${menu.id}"]`);
          if (checkbox) checkbox.checked = true;
        });
      }

      adminNotesInput.value = editingBooking.adminNotes || '';

      const start = editingBooking.startTime.toDate();
      const end = editingBooking.endTime.toDate();
      startTimeSelect.value = `${String(start.getHours()).padStart(2, '0')}:${String(start.getMinutes()).padStart(2, '0')}`;

      // 終了時刻を30分単位に丸める
      const endMinutesTotal = end.getHours() * 60 + end.getMinutes();
      const roundedEndMinutes = Math.ceil(endMinutesTotal / 30) * 30;
      const endH = Math.floor(roundedEndMinutes / 60);
      const endM = roundedEndMinutes % 60;
      const endTimeStr = `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;

      if (endTimeSelect.querySelector(`option[value="${endTimeStr}"]`)) {
        endTimeSelect.value = endTimeStr;
      } else {
        endTimeSelect.value = endTimeSelect.options[endTimeSelect.options.length - 1].value;
      }

      deleteBtn.style.display = 'inline-block';
    }

    startTimeSelect.disabled = false;
    endTimeSelect.disabled = false;

    openModal(editModal);
  };

  const handleCustomerInputChange = () => {
    const customerName = customerInput.value.trim();
    const existingCustomer = customers.find((c) => c.name === customerName);
    if (customerName && !existingCustomer) {
      newCustomerFields.style.display = 'block';
      newCustomerKanaInput.required = true;
    } else {
      newCustomerFields.style.display = 'none';
      newCustomerKanaInput.required = false;
    }
  };

  const saveBooking = async (e) => {
    e.preventDefault();

    let customerId;
    let customerName = customerInput.value.trim();

    const existingCustomer = customers.find((c) => c.name === customerName);

    if (existingCustomer) {
      customerId = existingCustomer.id;
    } else {
      const newKana = newCustomerKanaInput.value.trim();
      const newPhone = newCustomerPhoneInput.value.trim();

      if (!customerName || !newKana) {
        alert('新しいお客様の場合、名前とふりがなは必須です。');
        return;
      }

      try {
        const newCustomerData = {
          name: customerName,
          kana: newKana,
          phone: newPhone,
          isLineUser: false,
          createdAt: serverTimestamp(),
        };
        const docRef = await addDoc(collection(db, 'users'), newCustomerData);
        customerId = docRef.id;

        customers.push({ id: customerId, ...newCustomerData });
        customerDatalist.innerHTML = customers
          .map((c) => `<option value="${c.name}"></option>`)
          .join('');
      } catch (error) {
        console.error('新規顧客の作成に失敗:', error);
        alert('新規顧客の作成に失敗しました。');
        return;
      }
    }

    if (!customerName) {
      alert('顧客名を入力してください。');
      return;
    }

    const selectedMenuCheckboxes = menuAccordionContainer.querySelectorAll('input:checked');
    const allMenus = menuCategories.flatMap((cat) => cat.menus);
    const selectedMenus = Array.from(selectedMenuCheckboxes).map((cb) => {
      const menu = allMenus.find((m) => m.id === cb.value);
      return { id: menu.id, name: menu.name, price: menu.price, duration: menu.duration };
    });

    if (selectedMenus.length === 0) {
      alert('メニューを1つ以上選択してください。');
      return;
    }

    const [startH, startM] = startTimeSelect.value.split(':').map(Number);
    const startTime = new Date(selectedDate);
    startTime.setHours(startH, startM, 0, 0);

    const [endH, endM] = endTimeSelect.value.split(':').map(Number);
    const endTime = new Date(selectedDate);
    endTime.setHours(endH, endM, 0, 0);

    const adminNotes = adminNotesInput.value.trim();

    const data = {
      customerId: customerId,
      customerName: customerName,
      selectedMenus: selectedMenus,
      startTime: Timestamp.fromDate(startTime),
      endTime: Timestamp.fromDate(endTime),
      status: 'confirmed',
      isConsultation: false,
      createdAt: serverTimestamp(),
      createdBy: 'admin',
      adminNotes: adminNotes,
    };

    try {
      if (editingBooking) {
        await setDoc(doc(db, 'reservations', editingBooking.id), data, { merge: true });
      } else {
        await addDoc(collection(db, 'reservations'), data);
      }
      closeModal(editModal);
    } catch (error) {
      console.error('予約の保存に失敗:', error);
      alert('予約の保存に失敗しました。');
    }
  };

  const deleteBooking = async () => {
    if (editingBooking && confirm('この予約または予約不可設定を削除しますか？')) {
      try {
        await deleteDoc(doc(db, 'reservations', editingBooking.id));
        closeModal(editModal);
        closeModal(detailModal);
      } catch (error) {
        console.error('予約の削除に失敗:', error);
        alert('予約の削除に失敗しました。');
      }
    }
  };

  const listenToReservations = () => {
    if (unsubscribeReservations) unsubscribeReservations();
    const startOfDay = new Date(selectedDate);
    const endOfDay = new Date(selectedDate);
    endOfDay.setHours(23, 59, 59, 999);

    const q = query(
      collection(db, 'reservations'),
      where('startTime', '>=', Timestamp.fromDate(startOfDay)),
      where('startTime', '<=', Timestamp.fromDate(endOfDay)),
      orderBy('startTime')
    );
    unsubscribeReservations = onSnapshot(q, (snapshot) => {
      reservations = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      renderTimeline(reservations);
    });
  };

  const loadDailyMemo = async () => {
    const dateId = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;
    const memoDocRef = doc(db, 'daily_memos', dateId);
    try {
      const docSnap = await getDoc(memoDocRef);
      dailyMemoEl.value = docSnap.exists() ? docSnap.data().content : '';
    } catch (error) {
      console.error('メモの読み込みエラー:', error);
    }
  };

  let memoTimeout;
  dailyMemoEl.addEventListener('input', () => {
    clearTimeout(memoTimeout);
    memoTimeout = setTimeout(async () => {
      const dateId = `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}`;
      try {
        await setDoc(doc(db, 'daily_memos', dateId), { content: dailyMemoEl.value });
      } catch (error) {
        console.error('メモの保存エラー:', error);
      }
    }, 1000);
  });

  const loadInitialDataForModals = async () => {
    // 顧客データのリアルタイム同期
    onSnapshot(collection(db, 'users'), (snapshot) => {
      customers = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      customers.sort((a, b) => (a.kana || '').localeCompare(b.kana || '', 'ja'));
      
      customerDatalist.innerHTML = customers
        .map((c) => `<option value="${c.name}"></option>`)
        .join('');
      
      // タイムラインを再描画して最新の顧客情報（LINEアイコン等）を反映
      if (typeof reservations !== 'undefined' && reservations) {
        renderTimeline(reservations);
      }
    });

    const categoriesSnapshot = await getDocs(
      query(collection(db, 'service_categories'), orderBy('order'))
    );
    const menusSnapshot = await getDocs(query(collectionGroup(db, 'menus'), orderBy('order')));

    const allMenus = menusSnapshot.docs.map((doc) => ({
      id: doc.id,
      ...doc.data(),
      categoryId: doc.ref.parent.parent.id,
    }));

    menuCategories = categoriesSnapshot.docs.map((catDoc) => {
      const category = { id: catDoc.id, ...catDoc.data() };
      return {
        ...category,
        menus: allMenus.filter((menu) => menu.categoryId === category.id),
      };
    });

    menuAccordionContainer.innerHTML = '';
    menuCategories.forEach((category) => {
      const accordion = document.createElement('details');
      accordion.className = 'menu-category-accordion';
      let menuHtml = '';
      category.menus.forEach((menu) => {
        menuHtml += `<label class="checkbox-label"><input type="checkbox" value="${menu.id}"> ${menu.name}</label>`;
      });
      accordion.innerHTML = `
                <summary class="accordion-header">${category.name}</summary>
                <div class="accordion-content">${menuHtml}</div>
            `;
      menuAccordionContainer.appendChild(accordion);
    });

    // ★★★ 編集モーダルのイベントリスナーをここに追加 ★★★
    menuAccordionContainer.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.addEventListener('change', calculateEndTime);
    });
    startTimeSelect.addEventListener('change', calculateEndTime);

    // ★★★ 時刻プルダウンの生成をここに移動 ★★★
    populateTimeSelects();
  };

  // ▼▼▼ 修正: 8:00～22:00でプルダウンを生成 ▼▼▼
  const populateTimeSelects = () => {
    startTimeSelect.innerHTML = '';
    endTimeSelect.innerHTML = '';
    unavailableStartTimeSelect.innerHTML = '';
    unavailableEndTimeSelect.innerHTML = '';

    for (let h = fixedStartHour; h <= fixedEndHour; h++) {
      for (let m = 0; m < 60; m += 30) {
        if (h === fixedEndHour && m > 0) continue;
        const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        startTimeSelect.add(new Option(time, time));
        endTimeSelect.add(new Option(time, time));
        unavailableStartTimeSelect.add(new Option(time, time));
        unavailableEndTimeSelect.add(new Option(time, time));
      }
    }
  };
  // ▲▲▲ 修正ここまで ▲▲▲

  // --- Initial Execution & Event Listeners Setup ---
  await loadSalonSettings();
  await loadInitialDataForModals(); // 時刻プルダウンの生成も含む
  await renderCalendar();
  listenToReservations();
  loadDailyMemo();

  prevMonthBtn.addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() - 1);
    renderCalendar();
  });
  nextMonthBtn.addEventListener('click', () => {
    currentDate.setMonth(currentDate.getMonth() + 1);
    renderCalendar();
  });
  bookingForm.addEventListener('submit', saveBooking);
  deleteBtn.addEventListener('click', deleteBooking);
  // ★★★ 予約不可フォームの保存イベント ★★★
  unavailableForm.addEventListener('submit', saveUnavailable);

  document.getElementById('detail-edit-btn').addEventListener('click', () => {
    closeModal(detailModal);
    openEditModal(editingBooking);
  });
  document.getElementById('detail-cancel-btn').addEventListener('click', deleteBooking);
  document.getElementById('unavailable-delete-btn').addEventListener('click', deleteBooking);

  customerInput.addEventListener('input', handleCustomerInputChange);

  document.querySelectorAll('.close-modal-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      closeModal(e.target.closest('.modal'));
    });
  });

  timelineSlotsEl.addEventListener('click', (e) => {
    if (!e.target.classList.contains('timeline-slots')) return;

    const rect = e.target.getBoundingClientRect();
    const y = e.clientY - rect.top;

    // ▼▼▼ 修正: 8時を0として計算 ▼▼▼
    const totalMinutes = y / 2 + fixedStartHour * 60;
    const hour = Math.floor(totalMinutes / 60);
    // ▲▲▲ 修正ここまで ▲▲▲
    const minute = Math.round((totalMinutes % 60) / 30) * 30;

    let finalHour = hour;
    let finalMinute = minute;

    // 分が60になった場合、時間を繰り上げる
    if (finalMinute === 60) {
      finalHour += 1;
      finalMinute = 0;
    }

    // 22:00を超えないように丸める
    if (finalHour > fixedEndHour) {
      finalHour = fixedEndHour;
      finalMinute = 0;
    }

    const time = `${String(finalHour).padStart(2, '0')}:${String(finalMinute).padStart(2, '0')}`;
    openActionModal(time);
  });

  // --- Camera & Photo Upload Logic ---
  const handleTakePhoto = () => {
    if (!photoUploadInput) return;
    photoUploadInput.setAttribute('capture', 'environment');
    photoUploadInput.click();
  };

  const uploadAndSavePhoto = async (file) => {
    if (!editingBooking || !editingBooking.customerId || !file) return;

    if (detailCameraBtn) {
      detailCameraBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
      detailCameraBtn.disabled = true;
    }

    try {
      const timestamp = Date.now();
      const storageRef = ref(
        storage,
        `users/${editingBooking.customerId}/gallery/${timestamp}-${file.name}`
      );

      const snapshot = await uploadBytes(storageRef, file);
      const downloadURL = await getDownloadURL(snapshot.ref);

      await addDoc(collection(db, `users/${editingBooking.customerId}/gallery`), {
        url: downloadURL,
        createdAt: serverTimestamp(),
        isBookingPhoto: true,
        bookingId: editingBooking.id,
      });

      alert('写真を保存しました');
    } catch (error) {
      console.error('写真のアップロードに失敗:', error);
      alert('写真のアップロードに失敗しました。');
    } finally {
      if (detailCameraBtn) {
        detailCameraBtn.innerHTML = '<i class="fa-solid fa-camera"></i>';
        detailCameraBtn.disabled = false;
      }
      if (photoUploadInput) {
        photoUploadInput.value = '';
      }
    }
  };

  if (detailCameraBtn) {
    detailCameraBtn.addEventListener('click', (e) => {
      e.preventDefault();
      handleTakePhoto();
    });
  }

  if (photoUploadInput) {
    photoUploadInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        uploadAndSavePhoto(e.target.files[0]);
      }
    });
  }
};

runAdminPage(bookingMain);
