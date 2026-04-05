const Student = {
    currentPeriod: null,
    cachedSchedule: null,
    cachedFiles: null,

    init: async () => {
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
    }
};
