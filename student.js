const Student = {
    currentPeriod: null,
    cachedSchedule: null,
    cachedFiles: null,

    init: async () => {
        Student.setupTabs();
        Student.setupProgressGradeSelector();
        await Student.setupPeriodSelector();
        Student.renderSchedule(true);
    },

    setupPeriodSelector: async () => {
        if (!Student.cachedSchedule) {
            Student.cachedSchedule = await Utils.getAllSchedule();
        }
        const schedule = Student.cachedSchedule;
        const periods = Utils.identifyPeriods(schedule);
        const selector = document.getElementById('student-period-select');
        
        selector.innerHTML = periods.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
        selector.innerHTML += '<option value="all">全て表示</option>';

        if (Student.currentPeriod === null) {
            Student.currentPeriod = 'all'; // Default to "すべて表示"
        }
        selector.value = Student.currentPeriod || 'all';

        selector.onchange = (e) => {
            Student.currentPeriod = e.target.value;
            Student.renderSchedule(true);
        };
    },

    renderSchedule: async (autoScroll = false) => {
        const container = document.getElementById('schedule-list');
        
        // Show loading state if it's the first time
        if (!Student.cachedSchedule || !Student.cachedFiles) {
            container.innerHTML = '<p class="glass" style="padding: 2rem; grid-column: 1/-1;">データを読み込んでいます...<br><span style="font-size: 0.8rem; color: var(--text-muted);">行事予定とファイル情報を同期中</span></p>';
        }

        // Parallel fetch for first time
        if (!Student.cachedSchedule || !Student.cachedFiles) {
            const [scheduleData, filesData] = await Promise.all([
                Utils.getAllSchedule(),
                Utils.getAllFiles()
            ]);
            Student.cachedSchedule = scheduleData;
            Student.cachedFiles = filesData;
        }

        const schedule = Student.cachedSchedule;
        const filesMap = Student.cachedFiles;
        const now = new Date();
        
        if (schedule.length === 0) {
            container.innerHTML = '<p class="glass" style="padding: 2rem; grid-column: 1/-1;">行事予定がインポートされていません。管理者に連絡してください。</p>';
            return;
        }

        const todayStr = now.toISOString().split('T')[0];
        let downloaded = [];
        try {
            downloaded = JSON.parse(localStorage.getItem('downloaded_days') || '[]');
        } catch(e) {
            downloaded = [];
        }

        // Load reminders
        let reminders = [];
        try {
            const snapshot = await db.collection('reminders').where('userId', '==', App.currentUser.email).get();
            snapshot.forEach(doc => reminders.push(doc.data()));
        } catch (e) {
            console.error('Error fetching reminders:', e);
        }

        let listHtml = '';
        let todayHtml = '';
        const periods = Utils.identifyPeriods(schedule);
        let scrollTargetId = null;

        const academicSort = (a, b) => {
            const ma = parseInt(a.月), da = parseInt(a.日);
            const mb = parseInt(b.月), db = parseInt(b.日);
            const rankA = (ma >= 4 ? ma - 4 : ma + 8) * 100 + da;
            const rankB = (mb >= 4 ? mb - 4 : mb + 8) * 100 + db;
            return rankA - rankB;
        };

        const sortedSchedule = [...schedule].sort(academicSort);

        for (let item of sortedSchedule) {
            const dateStr = item.id;
            const date = new Date(dateStr);
            const m = date.getMonth() + 1;
            const d = date.getDate();

            // Range filter: 4/1-12/1 and 1/1-3/31
            const inRange = (m === 12 && d === 1) || (m >= 4 && m < 12) || (m >= 1 && m <= 3);
            if (!inRange) continue;

            // Period filter
            if (Student.currentPeriod && Student.currentPeriod !== 'all') {
                const period = periods.find(p => p.name === Student.currentPeriod);
                if (period && (dateStr < period.start || dateStr > period.end)) continue;
            }

            const qFile = filesMap.get(dateStr + '-Q');
            const aFile = filesMap.get(dateStr + '-A');
            
            const reminder = reminders.find(r => r.id === dateStr);

            const isToday = dateStr === todayStr;
            const isPast = dateStr < todayStr;
            const isDownloaded = downloaded.includes(dateStr);
            const cardClass = `card glass ${isToday ? 'today' : (isPast ? 'past small-day' : 'small-day')} ${isDownloaded ? 'downloaded' : ''}`;
            const noImplementation = (item.実施有無 != 1 && item.実施有無 !== '1');

            // 1. Pre-generate timeline anchor if we cross the "Today" threshold
            if (!window._insertedAnchor && dateStr >= todayStr) {
                const todayM = now.getMonth() + 1;
                const todayD = now.getDate();
                listHtml += `
                    <div id="timeline-anchor" style="grid-column: 1/-1; text-align: center; padding: 1rem 0; margin-bottom: -0.5rem; color: var(--error); font-weight: bold; font-size: 1rem; display: flex; align-items: center; gap: 1rem; scroll-margin-top: 120px;">
                        <div style="flex: 1; height: 2px; background: linear-gradient(90deg, transparent, var(--error));"></div>
                        <span style="background: rgba(239, 68, 68, 0.15); padding: 0.5rem 1.5rem; border-radius: 30px; border: 2px solid var(--error); box-shadow: 0 0 15px rgba(239, 68, 68, 0.3);">🔴 今日（${todayM}/${todayD}）はここ</span>
                        <div style="flex: 1; height: 2px; background: linear-gradient(-90deg, transparent, var(--error));"></div>
                    </div>
                `;
                window._insertedAnchor = true;
                if (!scrollTargetId) scrollTargetId = 'timeline-anchor';
            }

            let cardHtml = '';

            if (isToday) {
                // TALL VERTICAL HERO LAYOUT for Today
                if (noImplementation) {
                    todayHtml += `
                        <div class="card glass today" id="card-${dateStr}" style="display: flex; flex-direction: column; min-height: 600px; justify-content: center; align-items: center; text-align: center; padding: 2rem;">
                            <span class="status-badge status-0" style="font-size: 1.2rem; padding: 0.5rem 1.5rem;">実施なし</span>
                            <div style="font-size: 1.5rem; color: var(--text-muted); margin-top: 2rem;">${item.月}/${item.日} (${item.曜日})</div>
                            <h4 style="font-size: 2.5rem; line-height: 1.4; margin-top: 1rem;">${item.行事名}</h4>
                            <p style="color: var(--text-muted); margin-top: 3rem; font-size: 1.2rem;">本日のプリント学習はありません</p>
                        </div>
                    `;
                } else {
                    todayHtml += `
                        <div class="card glass today" id="card-${dateStr}" style="display: flex; flex-direction: column; min-height: 700px; justify-content: flex-start; padding: 2.5rem 2rem;">
                            <div style="text-align: center; margin-bottom: auto;">
                                <span class="status-badge status-1" style="font-size: 1rem; padding: 0.4rem 1.2rem;">本日の課題</span>
                                <div style="font-size: 1.3rem; color: var(--text-muted); margin-top: 1.5rem; font-weight: bold;">${item.月}/${item.日} (${item.曜日})</div>
                                <h4 style="font-size: 2.6rem; line-height: 1.3; margin-top: 1rem; font-weight: 700;">${item.行事名}</h4>
                            </div>

                            <div style="display: flex; flex-direction: column; gap: 1.2rem; margin: 3rem 0;">
                                <button onclick="Student.downloadFile('${dateStr}-Q')" ${!qFile ? 'disabled' : ''} 
                                        style="min-height: 75px; font-size: 1.4rem; border-radius: 16px; background: ${qFile ? 'var(--primary)' : 'rgba(255,255,255,0.05)'}; color: ${qFile ? 'white' : 'var(--text-muted)'}; font-weight: bold; width: 100%;">
                                    📝 問題を解く ${qFile ? '⬇️' : ''}
                                </button>
                                <button onclick="Student.downloadFile('${dateStr}-A')" ${!aFile ? 'disabled' : ''} 
                                        style="min-height: 75px; font-size: 1.4rem; border-radius: 16px; background: ${aFile ? 'var(--success)' : 'rgba(255,255,255,0.05)'}; color: ${aFile ? 'white' : 'var(--text-muted)'}; font-weight: bold; width: 100%;">
                                    💡 解答を見る ${aFile ? '⬇️' : ''}
                                </button>
                            </div>

                            <div style="margin-top: auto; padding-top: 1.5rem; border-top: 2px solid var(--glass-border);">
                                <label for="interval-${dateStr}" style="font-size: 1.1rem; font-weight: bold; margin-bottom: 0.8rem; display: block;">⏰ 解きなおしを予約</label>
                                <select id="interval-${dateStr}" onchange="Student.updateReminder('${dateStr}')" 
                                        style="width: 100%; height: 60px; font-size: 1.2rem; border-radius: 12px; background: ${reminder ? 'var(--primary)' : 'rgba(0,0,0,0.3)'}; color: white; border: 1px solid var(--glass-border); text-align: center; font-weight: bold;">
                                    <option value="none" ${!reminder ? 'selected' : ''}>復習を予約しない</option>
                                    <option value="1w" ${reminder?.interval === '1w' ? 'selected' : ''}>1週間後に復習</option>
                                    <option value="2w" ${reminder?.interval === '2w' ? 'selected' : ''}>2週間後に復習</option>
                                    <option value="3w" ${reminder?.interval === '3w' ? 'selected' : ''}>3週間後に復習</option>
                                    <option value="holiday" ${reminder?.interval === 'holiday' ? 'selected' : ''}>次の長期休暇</option>
                                    <option value="calendar" ${reminder?.interval === 'calendar' ? 'selected' : ''}>📅 カレンダー</option>
                                </select>
                                <div id="remind-date-${dateStr}" style="font-size: 0.95rem; color: var(--primary); margin-top: 0.8rem; font-weight: bold; text-align: center;">
                                    ${reminder ? '📅 予定日: ' + (reminder.displayLabel || reminder.scheduledDate) : ''}
                                </div>
                            </div>
                        </div>
                    `;
                }
            } else if (noImplementation) {
                // Timeline no-implementation card
                listHtml += `
                    <div class="${cardClass}" id="card-${dateStr}" style="padding: 1rem; display: flex; align-items: center; justify-content: space-between;">
                        <div>
                            <span style="font-size: 0.70rem; color: var(--text-muted);">${item.月}/${item.日}(${item.曜日})</span>
                            <h5 style="margin: 0.2rem 0 0 0; font-size: 0.95rem; line-height: 1.3;">${item.行事名}</h5>
                        </div>
                        <span class="status-badge status-0" style="font-size: 0.75rem;">なし</span>
                    </div>
                `;
            } else if (isPast) {
                // Highly compact layout for past entries
                listHtml += `
                    <div class="${cardClass}" id="card-${dateStr}" style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
                        <div style="flex: 1; min-width: 0;">
                            <div style="display: flex; align-items: flex-start; gap: 0.5rem;">
                                <span style="font-size: 0.70rem; color: var(--text-muted); white-space: nowrap; margin-top: 0.1rem;">${item.月}/${item.日}(${item.曜日})</span>
                                <h5 style="margin: 0; font-size: 0.95rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; white-space: normal; line-height: 1.3;" title="${item.行事名}">${item.行事名}</h5>
                            </div>
                        </div>
                        
                        <div style="display: flex; gap: 0.4rem; align-items: center; flex-shrink: 0;">
                            <button onclick="Student.downloadFile('${dateStr}-Q')" ${!qFile ? 'disabled' : ''} 
                                    style="padding: 0; width: 44px; height: 44px; border-radius: 12px; font-size: 1.2rem; display: flex; align-items: center; justify-content: center; background: ${qFile ? 'var(--primary)' : 'rgba(255,255,255,0.05)'}; color: ${qFile ? 'white' : 'var(--text-muted)'};">
                                📝
                            </button>
                            <button onclick="Student.downloadFile('${dateStr}-A')" ${!aFile ? 'disabled' : ''} 
                                    style="padding: 0; width: 44px; height: 44px; border-radius: 12px; font-size: 1.2rem; display: flex; align-items: center; justify-content: center; background: ${aFile ? 'var(--success)' : 'rgba(255,255,255,0.05)'}; color: ${aFile ? 'white' : 'var(--text-muted)'};">
                                💡
                            </button>
                            
                            <div style="display: flex; flex-direction: column; width: 90px; margin-left: 0.3rem;">
                                <select id="interval-${dateStr}" onchange="Student.updateReminder('${dateStr}')" 
                                        style="width: 100%; height: 44px; font-size: 0.75rem; padding: 0 0.2rem; border-radius: 12px; border: 1px solid var(--glass-border); background: ${reminder ? 'var(--primary)' : 'rgba(0,0,0,0.3)'}; color: white; text-align: center; font-weight: bold;">
                                    <option value="none" ${!reminder ? 'selected' : ''}>復習なし</option>
                                    <option value="1w" ${reminder?.interval === '1w' ? 'selected' : ''}>1週後</option>
                                    <option value="2w" ${reminder?.interval === '2w' ? 'selected' : ''}>2週後</option>
                                    <option value="3w" ${reminder?.interval === '3w' ? 'selected' : ''}>3週後</option>
                                    <option value="holiday" ${reminder?.interval === 'holiday' ? 'selected' : ''}>次休暇</option>
                                    <option value="calendar" ${reminder?.interval === 'calendar' ? 'selected' : ''}>📅選ぶ</option>
                                </select>
                                ${reminder ? `<div id="remind-date-${dateStr}" style="font-size: 0.6rem; color: var(--primary); text-align: center; margin-top: 0.2rem; font-weight: bold;">予定: ${reminder.displayLabel || reminder.scheduledDate.substring(5)}</div>` : ''}
                            </div>
                        </div>
                    </div>
                `;
            } else {
                // Standard layout for FUTURE entries in the timeline
                listHtml += `
                    <div class="${cardClass}" id="card-${dateStr}">
                        <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                            <div>
                                <span style="font-size: 0.85rem; color: var(--text-muted); font-weight: bold;">${item.月}/${item.日} (${item.曜日})</span>
                                <h4 style="margin-top: 0.4rem; font-size: 1.2rem; line-height: 1.3;">${item.行事名}</h4>
                            </div>
                            <span class="status-badge status-${item.実施有無}" style="font-size: 0.8rem; padding: 0.3rem 0.6rem;">${item.実施有無 == 1 ? '実施' : 'なし'}</span>
                        </div>

                        <div style="margin-top: 1.5rem; display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
                            <button onclick="Student.downloadFile('${dateStr}-Q')" ${!qFile ? 'disabled' : ''} 
                                    style="min-height: 54px; font-size: 1rem; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 0.5rem; background: ${qFile ? 'var(--primary)' : 'rgba(255,255,255,0.05)'}; color: ${qFile ? 'white' : 'var(--text-muted)'}; font-weight: bold;">
                                📝 問題を解く ${qFile ? '⬇️' : ''}
                            </button>
                            <button onclick="Student.downloadFile('${dateStr}-A')" ${!aFile ? 'disabled' : ''} 
                                    style="min-height: 54px; font-size: 1rem; border-radius: 12px; display: flex; align-items: center; justify-content: center; gap: 0.5rem; background: ${aFile ? 'var(--success)' : 'rgba(255,255,255,0.05)'}; color: ${aFile ? 'white' : 'var(--text-muted)'}; font-weight: bold;">
                                💡 解答を見る ${aFile ? '⬇️' : ''}
                            </button>
                        </div>

                        <div style="margin-top: 1.5rem; padding-top: 1.2rem; border-top: 1px solid var(--glass-border);">
                            <label for="interval-${dateStr}" style="font-size: 0.9rem; font-weight: bold; margin-bottom: 0.5rem; display: block;">⏰ 解きなおしを予約（リマインド）</label>
                            <select id="interval-${dateStr}" onchange="Student.updateReminder('${dateStr}')" 
                                    style="width: 100%; height: 50px; font-size: 1rem; border-radius: 12px; background: ${reminder ? 'var(--primary)' : 'rgba(0,0,0,0.3)'}; color: white; border: 1px solid var(--glass-border); padding: 0 1rem; font-weight: bold;">
                                <option value="none" ${!reminder ? 'selected' : ''}>復習を予約しない</option>
                                <option value="1w" ${reminder?.interval === '1w' ? 'selected' : ''}>1週間後に復習</option>
                                <option value="2w" ${reminder?.interval === '2w' ? 'selected' : ''}>2週間後に復習</option>
                                <option value="3w" ${reminder?.interval === '3w' ? 'selected' : ''}>3週間後に復習</option>
                                <option value="holiday" ${reminder?.interval === 'holiday' ? 'selected' : ''}>次の長期休暇に復習</option>
                                <option value="calendar" ${reminder?.interval === 'calendar' ? 'selected' : ''}>📅 カレンダーから選ぶ</option>
                            </select>
                            <div id="remind-date-${dateStr}" style="font-size: 0.85rem; color: var(--primary); margin-top: 0.5rem; font-weight: bold; display: flex; align-items: center; gap: 0.3rem;">
                                ${reminder ? '📅 予定日: ' + (reminder.displayLabel || reminder.scheduledDate) : ''}
                            </div>
                        </div>
                    </div>
                `;
            }
        }

        // Just in case all events are strictly in the past, force generating the anchor at the very end
        if (!window._insertedAnchor) {
            const todayM = now.getMonth() + 1;
            const todayD = now.getDate();
            listHtml += `
                <div id="timeline-anchor" style="grid-column: 1/-1; text-align: center; padding: 1rem 0; margin-bottom: -0.5rem; color: var(--error); font-weight: bold; font-size: 1rem; display: flex; align-items: center; gap: 1rem; scroll-margin-top: 120px;">
                    <div style="flex: 1; height: 2px; background: linear-gradient(90deg, transparent, var(--error));"></div>
                    <span style="background: rgba(239, 68, 68, 0.15); padding: 0.5rem 1.5rem; border-radius: 30px; border: 2px solid var(--error); box-shadow: 0 0 15px rgba(239, 68, 68, 0.3);">🔴 今日（${todayM}/${todayD}）はここ</span>
                    <div style="flex: 1; height: 2px; background: linear-gradient(-90deg, transparent, var(--error));"></div>
                </div>
            `;
            if (!scrollTargetId) scrollTargetId = 'timeline-anchor';
        }

        // Reset the tracker for next render
        window._insertedAnchor = false;

        if (!todayHtml) {
            todayHtml = `
                <div class="card glass today" style="text-align: center; padding: 3rem 1rem;">
                    <h3 style="color: var(--text-muted); margin-bottom: 0.5rem; font-size: 2.5rem;">🏖️</h3>
                    <p style="color: var(--text-muted); font-weight: bold; font-size: 1.1rem;">本日の学習予定はありません</p>
                </div>
            `;
        }

        // Render both panes
        const todayPanel = document.getElementById('today-panel');
        if (todayPanel) todayPanel.innerHTML = todayHtml;
        container.innerHTML = listHtml;

        if (autoScroll && scrollTargetId && Student.currentPeriod === 'all') {
            setTimeout(() => {
                const targetEl = document.getElementById(scrollTargetId);
                if (targetEl) {
                    // Offset is now cleanly handled by CSS scroll-margin-top on the timeline anchor
                    targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 100);
        }
    },

    downloadFile: (id) => {
        // Use synchronous cache access to preserve user gesture context (essential for Safari/iOS)
        const fileData = Student.cachedFiles ? Student.cachedFiles.get(id) : null;
        
        if (!fileData) {
            // Fallback if not in cache (popup blocker might trigger if this is slow)
            Utils.getFile(id).then(data => {
                if (data && data.url) {
                    window.open(data.url, '_blank');
                    Student.markFileDownloaded(id);
                } else {
                    alert('ファイルが存在しないか、読み込めませんでした');
                }
            });
            return;
        }

        // Trigger opening in a new tab immediately (synchronous action is allowed by Safari)
        window.open(fileData.url, '_blank');
        Student.markFileDownloaded(id);
    },

    markFileDownloaded: (id) => {
        const dateStr = id.replace(/-[QA]$/, '');
        let downloaded = [];
        try {
            downloaded = JSON.parse(localStorage.getItem('downloaded_days') || '[]');
        } catch(e) {
            downloaded = [];
        }
        
        if (!downloaded.includes(dateStr)) {
            downloaded.push(dateStr);
            localStorage.setItem('downloaded_days', JSON.stringify(downloaded));
            Student.renderSchedule();
        }
    },

    updateReminder: async (dateId) => {
        const select = document.getElementById(`interval-${dateId}`);
        const interval = select.value;
        
        if (interval === 'none') {
            try {
                await db.collection('reminders').doc(`${App.currentUser.email}_${dateId}`).delete();
                Student.renderSchedule();
            } catch (e) { console.error('Error deleting reminder:', e); }
            return;
        }

        let scheduledDate = '';
        let displayLabel = '';
        if (interval === 'calendar') {
            scheduledDate = await Student.openCalendarPicker(dateId);
            if (!scheduledDate) {
                Student.renderSchedule();
                return;
            }
        } else if (interval === 'holiday') {
            const h = Student.calculateHolidayDate(dateId);
            scheduledDate = h.date;
            displayLabel = h.label;
        } else {
            const weeks = parseInt(interval.charAt(0));
            const date = new Date(dateId);
            date.setDate(date.getDate() + weeks * 7);
            scheduledDate = date.toISOString().split('T')[0];
        }

        try {
            await db.collection('reminders').doc(`${App.currentUser.email}_${dateId}`).set({ 
                userId: App.currentUser.email,
                id: dateId, 
                interval, 
                scheduledDate, 
                displayLabel 
            });
            Student.renderSchedule();
        } catch (e) {
            console.error('Error saving reminder:', e);
        }
    },

    calculateHolidayDate: (baseDateStr) => {
        const date = new Date(baseDateStr);
        const month = date.getMonth() + 1;
        const day = date.getDate();
        const year = date.getFullYear();

        let start, end, label;

        // Apr 1 - Jul 20 -> Jul 21 - Aug 20
        if ((month >= 4 && month <= 6) || (month === 7 && day <= 20)) {
            start = new Date(year, 6, 21); // July is 6
            end = new Date(year, 7, 20);   // Aug is 7
            label = "夏休み(7/21〜8/20)";
        } 
        // Aug 25 - Dec 25 -> Dec 26 - Jan 5
        else if ((month >= 8 && day >= 25) || (month >= 9 && month <= 11) || (month === 12 && day <= 25)) {
            start = new Date(year, 11, 26);
            end = new Date(year + 1, 0, 5); 
            label = "冬休み(12/26〜1/5)";
        }
        // Jan 8 - Mar 20 -> Mar 21 - Apr 8
        else if ((month === 1 && day >= 8) || (month === 2) || (month === 3 && day <= 20)) {
            start = new Date(year, 2, 21);
            end = new Date(year, 3, 8);
            label = "春休み(3/21〜4/8)";
        }
        else {
            // Default to 1 month later if not in holiday ranges
            start = new Date(date);
            start.setMonth(start.getMonth() + 1);
            const y = start.getFullYear();
            const m = String(start.getMonth() + 1).padStart(2, '0');
            const d = String(start.getDate()).padStart(2, '0');
            return { date: `${y}-${m}-${d}`, label: `1ヶ月後(${m}/${d})` };
        }

        const diff = end.getTime() - start.getTime();
        const randomTime = start.getTime() + Math.random() * diff;
        const res = new Date(randomTime);
        const resY = res.getFullYear();
        const resM = String(res.getMonth() + 1).padStart(2, '0');
        const resD = String(res.getDate()).padStart(2, '0');
        return { date: `${resY}-${resM}-${resD}`, label: label };
    },

    openCalendarPicker: async (dateId) => {
        // Modal for calendar
        const modal = document.getElementById('calendar-modal');
        const grid = document.getElementById('calendar-grid');
        modal.style.display = 'flex';

        const schedule = await Utils.getAllSchedule();
        
        return new Promise(resolve => {
            grid.innerHTML = '';
            schedule.forEach(item => {
                const btn = document.createElement('button');
                btn.className = 'glass';
                btn.style.padding = '0.5rem';
                btn.style.fontSize = '0.7rem';
                btn.style.margin = '0.2rem';
                btn.style.width = '100px';
                btn.innerHTML = `${item.月}/${item.日}<br><small>${item.行事名}</small>`;
                btn.onclick = () => {
                    modal.style.display = 'none';
                    resolve(item.id);
                };
                grid.appendChild(btn);
            });

            document.getElementById('close-modal').onclick = () => {
                modal.style.display = 'none';
                resolve(null);
            };
        });
    },

    // ---------------------------------------------------------
    // 受験対策・単元進捗管理機能のロジック
    // ---------------------------------------------------------
    progressState: null,

    // 数学カリキュラムの全マスタデータ
    mathCurriculum: [
        {
            grade: 1,
            subject: "数学I",
            unit: "数と式",
            details: ["式の展開", "因数分解", "実数", "根号を含む式の計算", "1次不等式"]
        },
        {
            grade: 1,
            subject: "数学I",
            unit: "集合と命題",
            details: ["集合", "命題と条件", "命題と証明"]
        },
        {
            grade: 1,
            subject: "数学I",
            unit: "2次関数",
            details: ["関数とグラフ", "２次関数のグラフとその移動", "２次関数の最大・最小と決定", "２次方程式", "グラフと２次方程式", "２次不等式"]
        },
        {
            grade: 1,
            subject: "数学I",
            unit: "図形と計量",
            details: ["三角比の基本", "三角比の拡張", "正弦定理と余弦定理", "三角形の面積、空間図形への応用"]
        },
        {
            grade: 1,
            subject: "数学I",
            unit: "データの分析",
            details: ["データの整理、データの代表値", "データの散らばり", "分散と標準偏差", "データの相関", "仮説検定の考え方"]
        },
        {
            grade: 1,
            subject: "数学A",
            unit: "場合の数",
            details: ["集合の要素の個数", "場合の数", "順列", "円順列・重複順列", "組み合わせ"]
        },
        {
            grade: 1,
            subject: "数学A",
            unit: "確率",
            details: ["事象と確率", "確率の基本性質", "独立な試行・反復試行の確率", "条件付き確率", "期待値"]
        },
        {
            grade: 1,
            subject: "数学A",
            unit: "図形の性質",
            details: ["三角形の辺の比、五心", "チェバの定理、メネラウスの定理", "三角形の辺と角", "円に内接する四角形", "円と直線、２つの円の位置関係", "作図", "空間図形"]
        },
        {
            grade: 2,
            subject: "数学II",
            unit: "式と証明",
            details: ["二項定理", "多項式の割り算", "分数式とその計算", "恒等式", "等式の証明", "不等式の証明"]
        },
        {
            grade: 2,
            subject: "数学II",
            unit: "複素数と方程式",
            details: ["複素数", "2次方程式の解と判別式", "解と係数の関係", "解の存在範囲", "剰余の定理と因数定理", "高次方程式"]
        },
        {
            grade: 2,
            subject: "数学II",
            unit: "図形と方程式",
            details: ["点と座標", "直線の方程式、2直線の関係", "円の方程式", "円と直線", "2つの円", "軌跡と方程式", "不等式の表す領域"]
        },
        {
            grade: 2,
            subject: "数学II",
            unit: "三角関数",
            details: ["一般角と三角関数", "三角関数の性質、グラフ", "方程式,不等式,最大・最小", "加法定理", "和と積の公式", "三角関数の合成", "三角関数の種々の問題"]
        },
        {
            grade: 2,
            subject: "数学II",
            unit: "指数関数・対数関数",
            details: ["指数の拡張", "指数関数", "対数とその性質", "対数関数", "常用対数"]
        },
        {
            grade: 2,
            subject: "数学II",
            unit: "微分法",
            details: ["微分係数", "導関数", "接線", "関数の増減,極值", "最大値・最小值", "グラフと方程式・不等式"]
        },
        {
            grade: 2,
            subject: "数学II",
            unit: "積分法",
            details: ["不定積分", "定積分", "定積分で表された関数", "面積"]
        },
        {
            grade: 2,
            subject: "数学B",
            unit: "数列",
            details: ["等差数列", "等比数列", "和の記号∑", "階差数列", "いろいろな数列の和", "漸化式と数列", "数学的帰納法"]
        },
        {
            grade: 2,
            subject: "数学C",
            unit: "平面上のベクトル",
            details: ["ベクトルの演算", "ベクトルの成分", "ベクトルの内積", "位置ベクトル", "ベクトルと図形", "ベクトル方程式"]
        },
        {
            grade: 2,
            subject: "数学C",
            unit: "空間のベクトル",
            details: ["空間の座標", "空間のベクトル、ベクトルの成分", "空間のベクトルの内積", "位置ベクトル、ベクトルと図形", "座標空間における図形", "平面の方程式、直線の方程式"]
        },
        {
            grade: 2,
            subject: "数学C",
            unit: "複素数平面（理系）",
            details: ["複素数平面", "複素数の極形式と乗法、除法", "ド・モアブルの定理", "複素数と図形 (1)", "複素数と図形 (2)"]
        },
        {
            grade: 2,
            subject: "数学C",
            unit: "式と曲線（理系）",
            details: ["放物線,楕円", "双曲線", "2次曲線の移動", "2次曲線と直線", "2次曲線の性質", "曲線の媒介変数表示", "極座標,極方程式"]
        },
        {
            grade: 3,
            subject: "数学B",
            unit: "統計的な推測（文系）",
            details: ["確率変数と確率分布", "確率変数の変換", "確率変数の和と期待値", "二項分布", "正規分布", "母集団と標本、標本平均とその分布", "推定", "仮説検定"]
        },
        {
            grade: 3,
            subject: "数学III",
            unit: "関数（理系）",
            details: ["分数関数", "無理関数", "逆関数と合成関数"]
        },
        {
            grade: 3,
            subject: "数学III",
            unit: "極限",
            details: ["数列の極限", "無限等比数列", "無限級数", "関数の極限", "三角関数と極限", "関数の連続性"]
        },
        {
            grade: 3,
            subject: "数学III",
            unit: "微分法",
            details: ["微分係数と導関数", "導関数の計算", "いろいろな関数の導関数", "第n次導関数、関数のいろいろな表し方"]
        },
        {
            grade: 3,
            subject: "数学III",
            unit: "微分法の応用",
            details: ["接線と法線", "平均値の定理", "関数の値の変化、最大・最小", "関数のグラフ", "方程式,不等式への応用", "速度と加速度,近似式"]
        },
        {
            grade: 3,
            subject: "数学III",
            unit: "積分法",
            details: ["不定積分とその基本性質", "不定積分の置換積分法・部分積分法", "いろいろな関数の不定積分", "定積分とその基本性質", "定積分の置換積分法・部分積分法", "定積分で表された関数", "定積分と和の極限", "定積分と不等式"]
        }
    ],

    setupTabs: () => {
        const btnDaily = document.getElementById('tab-daily-learning');
        const btnExam = document.getElementById('tab-exam-progress');
        if (!btnDaily || !btnExam) return;

        btnDaily.onclick = () => {
            btnDaily.classList.add('active');
            btnExam.classList.remove('active');
            document.getElementById('schedule-list').style.display = 'grid';
            document.getElementById('student-progress-dashboard').style.display = 'none';
            document.getElementById('student-header-controls').style.display = 'flex';
            
            // Re-run auto-scroll to today
            const anchor = document.getElementById('timeline-anchor');
            if (anchor && Student.currentPeriod === 'all') {
                setTimeout(() => {
                    anchor.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }, 100);
            }
        };

        btnExam.onclick = () => {
            btnExam.classList.add('active');
            btnDaily.classList.remove('active');
            document.getElementById('schedule-list').style.display = 'none';
            document.getElementById('student-progress-dashboard').style.display = 'flex';
            document.getElementById('student-header-controls').style.display = 'none';
            window.scrollTo({ top: 0, behavior: 'instant' });

            // Check for first-time grade confirmation
            const hasConfirmed = localStorage.getItem('has_confirmed_grade');
            if (!hasConfirmed) {
                Student.showGradeConfirmationModal();
            } else {
                // Show pointing finger animation for 4 seconds from 2nd time onwards
                const hint = document.getElementById('grade-pointer-hint');
                if (hint) {
                    hint.style.display = 'inline-flex';
                    setTimeout(() => {
                        hint.style.transition = 'opacity 0.8s ease';
                        hint.style.opacity = '0';
                        setTimeout(() => {
                            hint.style.display = 'none';
                            hint.style.opacity = '1';
                        }, 800);
                    }, 4000);
                }
            }

            Student.renderProgress();
        };
    },

    setupProgressGradeSelector: () => {
        const gradeSelector = document.getElementById('progress-grade-select');
        const courseSelector = document.getElementById('progress-course-select');
        if (!gradeSelector || !courseSelector) return;

        const savedGrade = localStorage.getItem('confirmed_grade');
        if (savedGrade) {
            gradeSelector.value = savedGrade;
        } else {
            let defaultGrade = '3';
            if (App.currentUser && App.currentUser.class) {
                const classStr = String(App.currentUser.class);
                if (classStr.includes('1') || classStr.includes('１')) defaultGrade = '1';
                else if (classStr.includes('2') || classStr.includes('２')) defaultGrade = '2';
                else if (classStr.includes('3') || classStr.includes('３')) defaultGrade = '3';
            }
            gradeSelector.value = defaultGrade;
        }

        const savedCourse = localStorage.getItem('confirmed_course');
        if (savedCourse) {
            courseSelector.value = savedCourse;
        } else {
            courseSelector.value = 'rikei'; // Default to Science
        }

        gradeSelector.onchange = (e) => {
            localStorage.setItem('confirmed_grade', e.target.value);
            localStorage.setItem('has_confirmed_grade', 'true');
            Student.renderProgress();
        };

        courseSelector.onchange = (e) => {
            localStorage.setItem('confirmed_course', e.target.value);
            localStorage.setItem('has_confirmed_grade', 'true');
            Student.renderProgress();
        };
    },

    showGradeConfirmationModal: () => {
        // Create backdrop
        const modal = document.createElement('div');
        modal.id = 'grade-confirm-modal';
        modal.className = 'glass';
        modal.style.position = 'fixed';
        modal.style.top = '0';
        modal.style.left = '0';
        modal.style.right = '0';
        modal.style.bottom = '0';
        modal.style.zIndex = '2000';
        modal.style.display = 'flex';
        modal.style.justifyContent = 'center';
        modal.style.alignItems = 'center';
        modal.style.background = 'rgba(0, 0, 0, 0.85)';
        modal.style.backdropFilter = 'blur(10px)';

        const card = document.createElement('div');
        card.className = 'calendar-content glass';
        card.style.padding = '2.5rem 2rem';
        card.style.textAlign = 'center';
        card.style.maxWidth = '440px';
        card.style.boxShadow = '0 20px 50px rgba(0,0,0,0.5)';
        card.style.border = '1px solid var(--glass-border)';
        card.style.borderRadius = '24px';
        card.style.background = 'rgba(15, 23, 42, 0.95)';

        let selectedGrade = '3';
        let selectedCourse = 'rikei';

        card.innerHTML = `
            <div style="font-size: 3rem; margin-bottom: 0.5rem; animation: bounce 2s infinite;">🏫</div>
            <h3 style="margin: 0 0 0.8rem 0; font-size: 1.5rem; font-weight: 700; color: white;">学年と文理区分を教えてください</h3>
            <p style="color: var(--text-muted); font-size: 0.85rem; line-height: 1.5; margin-bottom: 2rem;">
                最初の1回だけ設定をお願いします。<br>ご自身の学年と文理区分に合った最適なカリキュラムが表示されます。<br>
                <span style="color: var(--primary); font-weight: bold;">※後からいつでも変更できます。</span>
            </p>
            
            <!-- Grade Selection -->
            <div style="margin-bottom: 1.5rem; text-align: left;">
                <label style="font-weight: bold; font-size: 0.9rem; color: white; display: block; margin-bottom: 0.6rem;">🏫 学年を選択:</label>
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem;">
                    <button class="modal-select-btn grade-opt" data-val="1" style="padding: 0.6rem; font-size: 0.85rem; border-radius: 8px; border: 1px solid var(--glass-border); background: rgba(255,255,255,0.05); color: white; cursor: pointer; font-weight: bold; width: 100%;">1年生</button>
                    <button class="modal-select-btn grade-opt" data-val="2" style="padding: 0.6rem; font-size: 0.85rem; border-radius: 8px; border: 1px solid var(--glass-border); background: rgba(255,255,255,0.05); color: white; cursor: pointer; font-weight: bold; width: 100%;">2年生</button>
                    <button class="modal-select-btn grade-opt active" data-val="3" style="padding: 0.6rem; font-size: 0.85rem; border-radius: 8px; border: 2px solid var(--primary); background: rgba(99, 102, 241, 0.2); color: white; cursor: pointer; font-weight: bold; width: 100%;">3年生</button>
                </div>
            </div>
            
            <!-- Course Selection -->
            <div style="margin-bottom: 2.2rem; text-align: left;">
                <label style="font-weight: bold; font-size: 0.9rem; color: white; display: block; margin-bottom: 0.6rem;">📚 文理区分を選択:</label>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem;">
                    <button class="modal-select-btn course-opt active" data-val="rikei" style="padding: 0.8rem; font-size: 0.95rem; border-radius: 8px; border: 2px solid var(--primary); background: rgba(99, 102, 241, 0.2); color: white; cursor: pointer; font-weight: bold; width: 100%;">🧪 理系 (数IIIあり)</button>
                    <button class="modal-select-btn course-opt" data-val="bunkei" style="padding: 0.8rem; font-size: 0.95rem; border-radius: 8px; border: 1px solid var(--glass-border); background: rgba(255,255,255,0.05); color: white; cursor: pointer; font-weight: bold; width: 100%;">🎨 文系 (数IIIなし)</button>
                </div>
            </div>
            
            <button id="modal-confirm-btn" style="min-height: 52px; font-size: 1.1rem; font-weight: bold; border-radius: 12px; background: var(--success); color: white; border: none; cursor: pointer; width: 100%; box-shadow: 0 4px 15px rgba(16, 185, 129, 0.3);">設定を完了する ✨</button>
        `;

        modal.appendChild(card);
        document.body.appendChild(modal);

        // Add options behavior
        const gradeOpts = card.querySelectorAll('.grade-opt');
        const courseOpts = card.querySelectorAll('.course-opt');

        gradeOpts.forEach(btn => {
            btn.onclick = () => {
                gradeOpts.forEach(b => {
                    b.style.border = '1px solid var(--glass-border)';
                    b.style.background = 'rgba(255,255,255,0.05)';
                    b.classList.remove('active');
                });
                btn.style.border = '2px solid var(--primary)';
                btn.style.background = 'rgba(99, 102, 241, 0.2)';
                btn.classList.add('active');
                selectedGrade = btn.getAttribute('data-val');
            };
        });

        courseOpts.forEach(btn => {
            btn.onclick = () => {
                courseOpts.forEach(b => {
                    b.style.border = '1px solid var(--glass-border)';
                    b.style.background = 'rgba(255,255,255,0.05)';
                    b.classList.remove('active');
                });
                btn.style.border = '2px solid var(--primary)';
                btn.style.background = 'rgba(99, 102, 241, 0.2)';
                btn.classList.add('active');
                selectedCourse = btn.getAttribute('data-val');
            };
        });

        card.querySelector('#modal-confirm-btn').onclick = () => {
            localStorage.setItem('confirmed_grade', selectedGrade);
            localStorage.setItem('confirmed_course', selectedCourse);
            localStorage.setItem('has_confirmed_grade', 'true');
            
            const gradeSelect = document.getElementById('progress-grade-select');
            if (gradeSelect) gradeSelect.value = selectedGrade;

            const courseSelect = document.getElementById('progress-course-select');
            if (courseSelect) courseSelect.value = selectedCourse;
            
            // Fade out and remove
            modal.style.transition = 'opacity 0.3s ease';
            modal.style.opacity = '0';
            setTimeout(() => {
                modal.remove();
                Student.renderProgress();
            }, 300);
        };
    },

    getEvolutionStage: (percentage) => {
        if (percentage >= 100) {
            return {
                level: 5,
                avatar: "👑",
                stageName: "👑 数学の覇者 (Lv.Max)",
                title: "完全制覇！",
                message: "すべての単元をクリアしました！自信を持って入試に挑みましょう！",
                class: "evo-stage-5"
            };
        } else if (percentage >= 80) {
            return {
                level: 4,
                avatar: "🐉",
                stageName: "🐉 伝説のマスター (Lv.5)",
                title: "志望校合格まであと一歩！",
                message: "大樹のように知識が茂っています。最後の仕上げを行いましょう！",
                class: "evo-stage-4"
            };
        } else if (percentage >= 60) {
            return {
                level: 3,
                avatar: "⚔️",
                stageName: "⚔️ 実力派ナイト (Lv.4)",
                title: "実力が花開いてきた！",
                message: "綺麗な花が咲くように知識が定着してきました。過去問でさらに磨きましょう！",
                class: "evo-stage-3"
            };
        } else if (percentage >= 40) {
            return {
                level: 2,
                avatar: "🏹",
                stageName: "🏹 見習いハンター (Lv.3)",
                title: "受験の基礎が整ってきた！",
                message: "若葉が青々と茂るように、着実に解ける範囲が広がっています！",
                class: "evo-stage-2"
            };
        } else if (percentage >= 20) {
            return {
                level: 1,
                avatar: "🌱",
                stageName: "🌱 ひよっこ期 (Lv.2)",
                title: "少しずつ成長中！",
                message: "双葉が芽吹きました！この調子で基本の問題を積み重ねていきましょう。",
                class: "evo-stage-1"
            };
        } else {
            return {
                level: 0,
                avatar: "🥚",
                stageName: "🥚 タマゴ期 (Lv.1)",
                title: "冒険の始まり！",
                message: "まずは教科書の内容から確認して、土台を作っていきましょう！",
                class: "evo-stage-0"
            };
        }
    },

    renderProgress: async () => {
        const container = document.getElementById('curriculum-progress-list');
        if (!container) return;

        if (!Student.progressState) {
            container.innerHTML = '<p class="glass" style="padding: 2rem;">進捗データを読み込んでいます...</p>';
            try {
                const doc = await db.collection('progress').doc(App.currentUser.email).get();
                if (doc.exists) {
                    Student.progressState = doc.data().progress || {};
                } else {
                    Student.progressState = {};
                }
            } catch (e) {
                console.error('Error fetching progress:', e);
                Student.progressState = {};
            }
        }

        Student.renderProgressUI();
    },

    renderProgressUI: () => {
        const container = document.getElementById('curriculum-progress-list');
        const gradeSelector = document.getElementById('progress-grade-select');
        if (!container || !gradeSelector) return;

        const maxGrade = parseInt(gradeSelector.value || '3');
        const courseSelector = document.getElementById('progress-course-select');
        const course = courseSelector ? courseSelector.value : (localStorage.getItem('confirmed_course') || 'rikei');

        // Filter curriculum by grade and course
        const filteredCurriculum = Student.mathCurriculum.filter(item => {
            // Grade check
            if (item.grade > maxGrade) return false;
            
            // Course check
            if (course === 'bunkei') {
                // Bunkei: No Math III, No (理系) units
                if (item.subject === '数学III') return false;
                if (item.unit.includes('（理系）') || item.unit.includes('(理系)')) return false;
            } else if (course === 'rikei') {
                // Rikei: No (文系) units
                if (item.unit.includes('（文系）') || item.unit.includes('(文系)')) return false;
            }
            
            return true;
        });

        // Group by Subject
        const subjects = {};
        filteredCurriculum.forEach(item => {
            if (!subjects[item.subject]) {
                subjects[item.subject] = [];
            }
            subjects[item.subject].push(item);
        });

        // Calculate progress stats (Weighted: Textbook:2, Workbook:2, Chart:2, Mock:1, Common:1)
        const STEP_WEIGHTS = [2, 2, 2, 1, 1];
        const UNIT_MAX_WEIGHT = 8; // 2 + 2 + 2 + 1 + 1

        let totalWeightPossible = filteredCurriculum.length * UNIT_MAX_WEIGHT;
        let totalWeightDone = 0;

        filteredCurriculum.forEach(item => {
            const key = `${item.grade}_${item.subject}_${item.unit}`;
            const state = Student.progressState[key] || [false, false, false, false, false];
            state.forEach((checked, index) => {
                if (checked) {
                    totalWeightDone += STEP_WEIGHTS[index];
                }
            });
        });

        const overallPercent = totalWeightPossible > 0 ? Math.round((totalWeightDone / totalWeightPossible) * 100) : 0;

        // Update overall progress percentage and bar
        document.getElementById('total-progress-percentage').innerText = `${overallPercent}%`;
        
        const progressBar = document.getElementById('total-progress-bar');
        if (progressBar) {
            progressBar.style.width = `${overallPercent}%`;
            
            // Dynamically change color and glow depending on the progress level
            let barColor = 'linear-gradient(90deg, var(--primary), var(--success))';
            let barGlow = '0 0 10px rgba(99, 102, 241, 0.5)';
            
            if (overallPercent >= 100) {
                barColor = 'linear-gradient(90deg, #f59e0b, #fbbf24, #f59e0b)'; // 👑 Gold Master
                barGlow = '0 0 15px rgba(245, 158, 11, 0.8)';
            } else if (overallPercent >= 80) {
                barColor = 'linear-gradient(90deg, #10b981, #34d399)'; // 🐉 Emerald Dragon
                barGlow = '0 0 12px rgba(16, 185, 129, 0.6)';
            } else if (overallPercent >= 60) {
                barColor = 'linear-gradient(90deg, #8b5cf6, #a78bfa)'; // ⚔️ Violet Knight
                barGlow = '0 0 10px rgba(139, 92, 246, 0.5)';
            } else if (overallPercent >= 40) {
                barColor = 'linear-gradient(90deg, #3b82f6, #60a5fa)'; // 🏹 Blue Hunter
                barGlow = '0 0 10px rgba(59, 130, 246, 0.5)';
            } else if (overallPercent >= 20) {
                barColor = 'linear-gradient(90deg, #f59e0b, #fbbf24)'; // 🌱 Amber Sprout
                barGlow = '0 0 10px rgba(245, 158, 11, 0.5)';
            } else {
                barColor = 'linear-gradient(90deg, #f43f5e, #fb7185)'; // 🥚 Rose Egg
                barGlow = '0 0 10px rgba(244, 63, 94, 0.5)';
            }
            
            progressBar.style.background = barColor;
            progressBar.style.boxShadow = barGlow;
        }

        // Update Subject-by-Subject Mini Progress Rates
        const miniContainer = document.getElementById('subject-progress-mini-rates');
        if (miniContainer) {
            let miniHtml = '';
            Object.keys(subjects).forEach(subjName => {
                const items = subjects[subjName];
                let subjPossible = items.length * UNIT_MAX_WEIGHT;
                let subjDone = 0;
                items.forEach(item => {
                    const key = `${item.grade}_${item.subject}_${item.unit}`;
                    const state = Student.progressState[key] || [false, false, false, false, false];
                    state.forEach((checked, index) => {
                        if (checked) {
                            subjDone += STEP_WEIGHTS[index];
                        }
                    });
                });
                const subjPercent = subjPossible > 0 ? Math.round((subjDone / subjPossible) * 100) : 0;
                
                miniHtml += `
                    <div style="text-align: center; flex: 1; min-width: 80px; padding: 0.5rem; background: rgba(255,255,255,0.02); border-radius: 12px; border: 1px solid rgba(255,255,255,0.05); box-shadow: 0 4px 10px rgba(0,0,0,0.15);">
                        <div style="font-size: 0.75rem; color: var(--text-muted); font-weight: bold; margin-bottom: 0.2rem;">${subjName}</div>
                        <div style="font-size: 1.1rem; font-weight: 700; color: white; font-family: 'Outfit', sans-serif;">${subjPercent}%</div>
                        <div style="width: 100%; height: 4px; background: rgba(0,0,0,0.3); border-radius: 2px; overflow: hidden; margin-top: 0.4rem;">
                            <div style="width: ${subjPercent}%; height: 100%; background: var(--primary);"></div>
                        </div>
                    </div>
                `;
            });
            miniContainer.innerHTML = miniHtml;
        }

        // Update Character Evolution Card
        const evoStage = Student.getEvolutionStage(overallPercent);
        const evoCard = document.getElementById('evolution-card');
        if (evoCard) {
            // Remove previous classes
            evoCard.className = 'card glass';
            evoCard.classList.add(evoStage.class);
        }
        document.getElementById('evolution-avatar').innerText = evoStage.avatar;
        document.getElementById('evolution-stage-badge').innerText = evoStage.stageName;
        document.getElementById('evolution-title').innerText = evoStage.title;
        document.getElementById('evolution-message').innerText = evoStage.message;

        // Render curriculum HTML
        let html = '';

        Object.keys(subjects).forEach(subjName => {
            const items = subjects[subjName];
            
            // Calculate progress for this subject (Weighted)
            let subjPossible = items.length * UNIT_MAX_WEIGHT;
            let subjDone = 0;
            items.forEach(item => {
                const key = `${item.grade}_${item.subject}_${item.unit}`;
                const state = Student.progressState[key] || [false, false, false, false, false];
                state.forEach((checked, index) => {
                    if (checked) {
                        subjDone += STEP_WEIGHTS[index];
                    }
                });
            });
            const subjPercent = subjPossible > 0 ? Math.round((subjDone / subjPossible) * 100) : 0;

            html += `
                <div class="curriculum-subject-group glass">
                    <div class="curriculum-subject-header" onclick="Student.toggleSubjectGroup(this)">
                        <div style="display: flex; align-items: center; gap: 1rem; flex: 1;">
                            <span style="font-size: 1.2rem; color: white;">${subjName}</span>
                            <span style="font-size: 0.8rem; background: rgba(255,255,255,0.1); padding: 0.2rem 0.6rem; border-radius: 20px; font-weight: normal; color: var(--text-muted);">
                                進捗率: ${subjPercent}% (${subjDone}/${subjPossible}ステップ)
                            </span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 1rem;">
                            <!-- Simple progress bar inside header -->
                            <div style="width: 100px; height: 8px; background: rgba(0,0,0,0.3); border-radius: 4px; overflow: hidden; border: 1px solid var(--glass-border);">
                                <div style="width: ${subjPercent}%; height: 100%; background: var(--primary);"></div>
                            </div>
                            <span class="accordion-arrow">🔽</span>
                        </div>
                    </div>
                    <div class="curriculum-units-container">
            `;

            items.forEach(item => {
                const key = `${item.grade}_${item.subject}_${item.unit}`;
                const state = Student.progressState[key] || [false, false, false, false, false];
                const completedSteps = state.filter(Boolean).length;

                html += `
                    <div class="unit-row">
                        <div class="unit-row-main">
                            <div class="unit-info-block">
                                <div class="unit-name">
                                    <span>🎯 ${item.unit}</span>
                                    <span style="font-size: 0.75rem; color: ${completedSteps === 5 ? 'var(--success)' : 'var(--text-muted)'}; font-weight: normal;">
                                        (${completedSteps}/5 完了)
                                    </span>
                                </div>
                                <div style="display: flex; gap: 0.5rem; align-items: center; margin-top: 0.3rem;">
                                    <button class="unit-details-toggle" onclick="Student.toggleDetails('${key}')" id="toggle-btn-${key}">
                                        学習内容を表示 🔽
                                    </button>
                                </div>
                            </div>

                            <div class="steps-container">
                                <button class="step-btn ${state[0] ? 'checked' : ''}" onclick="Student.toggleStep('${key}', 0)">
                                    ${state[0] ? '✅' : '⬜'} 教科書
                                </button>
                                <button class="step-btn ${state[1] ? 'checked' : ''}" onclick="Student.toggleStep('${key}', 1)">
                                    ${state[1] ? '✅' : '⬜'} 問題集
                                </button>
                                <button class="step-btn ${state[2] ? 'checked' : ''}" onclick="Student.toggleStep('${key}', 2)">
                                    ${state[2] ? '✅' : '⬜'} チャート重要
                                </button>
                                <button class="step-btn ${state[3] ? 'checked' : ''}" onclick="Student.toggleStep('${key}', 3)">
                                    ${state[3] ? '✅' : '⬜'} 進研模試過去問
                                </button>
                                <button class="step-btn ${state[4] ? 'checked' : ''}" onclick="Student.toggleStep('${key}', 4)">
                                    ${state[4] ? '✅' : '⬜'} 共通テスト過去問
                                </button>
                            </div>
                        </div>
                        <div class="unit-details-content" id="details-${key}" style="display: none;">
                            <strong>学習内容のヒント:</strong> ${item.details.join('、')}
                        </div>
                    </div>
                `;
            });

            html += `
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;
    },

    toggleStep: async (unitKey, stepIndex) => {
        if (!Student.progressState) Student.progressState = {};
        if (!Student.progressState[unitKey]) {
            Student.progressState[unitKey] = [false, false, false, false, false];
        }

        // Toggle state
        const newState = !Student.progressState[unitKey][stepIndex];
        Student.progressState[unitKey][stepIndex] = newState;

        if (newState) {
            Student.playSuccessSound(stepIndex);
        } else {
            Student.playRemoveSound();
        }

        // Re-render UI to be responsive immediately
        Student.renderProgressUI();

        // Write to Firestore in background
        try {
            await db.collection('progress').doc(App.currentUser.email).set({
                email: App.currentUser.email,
                progress: Student.progressState,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });
        } catch (e) {
            console.error('Error saving progress update:', e);
        }
    },

    toggleDetails: (unitKey) => {
        const detailsEl = document.getElementById(`details-${unitKey}`);
        const btnEl = document.getElementById(`toggle-btn-${unitKey}`);
        if (!detailsEl || !btnEl) return;

        if (detailsEl.style.display === 'none') {
            detailsEl.style.display = 'block';
            btnEl.innerHTML = '学習内容を折りたたむ 🔼';
        } else {
            detailsEl.style.display = 'none';
            btnEl.innerHTML = '学習内容を表示 🔽';
        }
    },

    toggleSubjectGroup: (headerEl) => {
        const groupEl = headerEl.parentElement;
        const container = groupEl.querySelector('.curriculum-units-container');
        const arrow = groupEl.querySelector('.accordion-arrow'); // fixed selection bug (groupEl instead of headerEl)
        if (!container || !arrow) return;

        if (container.style.display === 'none') {
            container.style.display = 'flex';
            arrow.innerText = '🔽';
        } else {
            container.style.display = 'none';
            arrow.innerText = '▶️';
        }
    },

    playSuccessSound: (stepIndex = 0) => {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            const ctx = new AudioContext();
            
            const playNote = (type, freq, startTime, duration, volume = 0.1) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                
                osc.type = type;
                osc.frequency.setValueAtTime(freq, startTime);
                
                gain.gain.setValueAtTime(volume, startTime);
                gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
                
                osc.connect(gain);
                gain.connect(ctx.destination);
                
                osc.start(startTime);
                osc.stop(startTime + duration);
            };
            
            const now = ctx.currentTime;
            
            if (stepIndex === 0) {
                // 教科書: Simple & clean rising double-beep
                playNote('sine', 523.25, now, 0.1, 0.08); // C5
                playNote('sine', 659.25, now + 0.06, 0.15, 0.08); // E5
            } else if (stepIndex === 1) {
                // 問題集: Pleasant standard triple chord
                playNote('triangle', 659.25, now, 0.1, 0.08); // E5
                playNote('triangle', 783.99, now + 0.06, 0.1, 0.08); // G5
                playNote('triangle', 1046.50, now + 0.12, 0.22, 0.08); // C6
            } else if (stepIndex === 2) {
                // チャート重要: Shimmering bell arpeggio
                playNote('triangle', 783.99, now, 0.08, 0.06); // G5
                playNote('triangle', 1046.50, now + 0.06, 0.08, 0.06); // C6
                playNote('triangle', 1318.51, now + 0.12, 0.08, 0.06); // E6
                playNote('sine', 1567.98, now + 0.18, 0.3, 0.08); // G6 (shimmer)
            } else if (stepIndex === 3) {
                // 進研模試過去問: Triumphant C major chord fanfare
                playNote('triangle', 523.25, now, 0.35, 0.06); // C5
                playNote('triangle', 659.25, now + 0.04, 0.35, 0.06); // E5
                playNote('triangle', 783.99, now + 0.08, 0.4, 0.06); // G5
                playNote('sine', 1046.50, now + 0.12, 0.45, 0.08); // C6
                playNote('sine', 1318.51, now + 0.16, 0.5, 0.06); // E6
            } else if (stepIndex === 4) {
                // 共通テスト過去問: Retro legendary level-up fanfare!
                playNote('triangle', 523.25, now, 0.08, 0.06);   // C5
                playNote('triangle', 659.25, now + 0.05, 0.08, 0.06); // E5
                playNote('triangle', 783.99, now + 0.10, 0.08, 0.06); // G5
                playNote('triangle', 1046.50, now + 0.15, 0.08, 0.06); // C6
                playNote('triangle', 1318.51, now + 0.20, 0.08, 0.06); // E6
                playNote('triangle', 1567.98, now + 0.25, 0.08, 0.06); // G6
                
                // End power chord
                playNote('sine', 2093.00, now + 0.30, 0.8, 0.08); // C7
                playNote('triangle', 1046.50, now + 0.30, 0.8, 0.06); // C6
                playNote('triangle', 1318.51, now + 0.30, 0.8, 0.06); // E6
                playNote('triangle', 1567.98, now + 0.30, 0.8, 0.06); // G6
            }
        } catch (e) {
            console.error('Sound play failed:', e);
        }
    },

    playRemoveSound: () => {
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (!AudioContext) return;
            const ctx = new AudioContext();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc.type = 'sine';
            osc.frequency.setValueAtTime(329.63, ctx.currentTime); // E4 (low tone)
            
            gain.gain.setValueAtTime(0.08, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.start();
            osc.stop(ctx.currentTime + 0.12);
        } catch (e) {}
    }
};

