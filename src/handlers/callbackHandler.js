const { getMainKeyboard, getConfirmKeyboard, getCancelKeyboard, getZipTypeKeyboard, getZipBuildTypeKeyboard } = require('../utils/keyboard');
const { buildApk } = require('../builder/apkBuilder');
const { buildFromZip } = require('../builder/zipBuilder');
const { sendBuildReport } = require('../utils/adminReporter');
const { formatBuildProgress, formatBuildStartMessage, formatSuccessMessage, formatErrorMessage, formatZipBuildProgress } = require('../utils/progressUI');
const { buildQueue } = require('../utils/buildQueue');
const licenseKeyService = require('../utils/licenseKeyService');
const path = require('path');
const fs = require('fs-extra');

/**
 * Handle callback queries from inline buttons
 */
async function handleCallback(bot, query) {
    const chatId = query.message.chat.id;
    const messageId = query.message.message_id;
    const data = query.data;

    // Extract user information from query
    const userInfo = {
        id: query.from.id,
        firstName: query.from.first_name || 'User',
        lastName: query.from.last_name || '',
        username: query.from.username || null
    };

    // Acknowledge callback
    await bot.answerCallbackQuery(query.id);

    switch (data) {
        case 'create_apk':
            await startCreateApk(bot, chatId, messageId, userInfo);
            break;

        case 'help':
            await showHelp(bot, chatId, messageId);
            break;

        case 'back_main':
            await backToMain(bot, chatId, messageId);
            break;

        case 'cancel':
            await cancelProcess(bot, chatId, messageId);
            break;

        case 'skip_icon':
            await skipIcon(bot, chatId, messageId);
            break;

        case 'confirm_build':
            await confirmBuild(bot, chatId, messageId);
            break;

        case 'build_zip':
            await startBuildZip(bot, chatId, messageId);
            break;

        case 'zip_android':
            await selectZipType(bot, chatId, messageId, 'android');
            break;

        case 'zip_flutter':
            await selectZipType(bot, chatId, messageId, 'flutter');
            break;

        case 'zipbuild_debug':
            await selectZipBuildType(bot, chatId, messageId, 'debug');
            break;

        case 'zipbuild_release':
            await selectZipBuildType(bot, chatId, messageId, 'release');
            break;

        case 'server_status':
            await showServerStatus(bot, chatId, messageId);
            break;

        case 'check_queue':
            await showQueueStatus(bot, chatId, messageId);
            break;

        case 'thanks_to':
            await showThanksTo(bot, chatId, messageId);
            break;

        case 'show_commands':
            await showCommandsMenu(bot, chatId, messageId, query.from);
            break;
    }
}

/**
 * Start APK creation flow
 */
async function startCreateApk(bot, chatId, messageId, userInfo = {}) {
    // Initialize session with user info
    const fullName = [userInfo.firstName, userInfo.lastName].filter(Boolean).join(' ').trim() || 'Unknown';

    global.sessions.set(chatId, {
        step: 'url',
        userName: fullName,
        userUsername: userInfo.username || null,
        data: {
            url: null,
            appName: null,
            iconPath: null,
            themeColor: '#2196F3'
        }
    });

    // Delete old photo message
    await bot.deleteMessage(chatId, messageId).catch(() => { });

    const message = `
📱 <b>Buat APK Baru</b>
━━━━━━━━━━━━━━━━━━

<b>Langkah 1/3: URL Website</b>

Silakan kirim URL website yang ingin dikonversi menjadi APK.

<i>Contoh: https://example.com</i>
    `.trim();

    await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: getCancelKeyboard()
    });
}

/**
 * Show help message
 */
async function showHelp(bot, chatId, messageId) {
    const helpMessage = `
📚 <b>PANDUAN WEB2APK BOT</b>
━━━━━━━━━━━━━━━━━━

<b>📱 Cara Membuat APK:</b>
1. Klik tombol "BUAT APLIKASI SEKARANG"
2. Masukkan URL website target
3. Masukkan nama aplikasi
4. Upload icon (opsional)
5. Tunggu proses build (~1-3 menit)

<b>💡 Tips:</b>
• URL harus dimulai dengan http:// atau https://
• Nama aplikasi maksimal 30 karakter
• Icon sebaiknya ukuran 512x512 px
• Format icon: JPG/PNG

<b>❓ Butuh Bantuan?</b>
Hubungi: @Izalnotdev
    `.trim();

    // Delete old message (photo) and send new text message
    await bot.deleteMessage(chatId, messageId).catch(() => { });

    await bot.sendMessage(chatId, helpMessage, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '◀️ Kembali ke Menu', callback_data: 'back_main' }]
            ]
        }
    });
}

/**
 * Show server status (queue status)
 */
async function showServerStatus(bot, chatId, messageId) {
    const currentBuild = buildQueue.getCurrentBuild();

    let statusMessage;
    if (currentBuild) {
        const duration = Math.round(currentBuild.duration / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;

        statusMessage = `
📊 <b>Status Server</b>
━━━━━━━━━━━━━━━━━━

🔴 <b>Status:</b> Sedang Build
⏱️ <b>Durasi:</b> ${minutes}m ${seconds}s

💡 <i>Server sedang memproses build. Silakan tunggu hingga selesai.</i>
        `.trim();
    } else {
        statusMessage = `
📊 <b>Status Server</b>
━━━━━━━━━━━━━━━━━━

🟢 <b>Status:</b> Tersedia
✅ <b>Antrian:</b> Kosong

💡 <i>Server siap menerima build baru!</i>
        `.trim();
    }

    // Delete old message (may be photo) and send new text message
    await bot.deleteMessage(chatId, messageId).catch(() => { });

    await bot.sendMessage(chatId, statusMessage, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔄 Refresh', callback_data: 'server_status' }],
                [{ text: '◀️ Kembali ke Menu', callback_data: 'back_main' }]
            ]
        }
    });
}

/**
 * Show Queue Status - shows if user's build is in queue
 */
async function showQueueStatus(bot, chatId, messageId) {
    const currentBuild = buildQueue.getCurrentBuild();
    const session = global.sessions.get(chatId);

    let queueMessage;

    if (currentBuild) {
        const duration = Math.round(currentBuild.duration / 1000);
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        const isMyBuild = currentBuild.chatId === chatId;

        if (isMyBuild) {
            queueMessage = `
📋 <b>Status Antrian Anda</b>
━━━━━━━━━━━━━━━━━━

🔄 <b>Status:</b> Sedang diproses
⏱️ <b>Durasi:</b> ${minutes}m ${seconds}s

<i>⏳ Build Anda sedang berjalan...</i>
            `.trim();
        } else {
            queueMessage = `
📋 <b>Status Antrian</b>
━━━━━━━━━━━━━━━━━━

🔴 <b>Server:</b> Sibuk
⏱️ <b>Build lain:</b> ${minutes}m ${seconds}s

💡 <i>Mohon tunggu hingga build selesai untuk memulai build baru.</i>
            `.trim();
        }
    } else if (session && session.step) {
        queueMessage = `
📋 <b>Status Antrian</b>
━━━━━━━━━━━━━━━━━━

📝 <b>Anda sedang:</b> ${getStepDescription(session.step)}

💡 <i>Lanjutkan proses atau batalkan untuk memulai baru.</i>
        `.trim();
    } else {
        queueMessage = `
📋 <b>Status Antrian</b>
━━━━━━━━━━━━━━━━━━

🟢 <b>Server:</b> Tersedia
✅ <b>Antrian:</b> Kosong
📝 <b>Proses Anda:</b> Tidak ada

💡 <i>Server siap! Klik tombol di bawah untuk build.</i>
        `.trim();
    }

    await bot.deleteMessage(chatId, messageId).catch(() => { });

    await bot.sendMessage(chatId, queueMessage, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '🔄 Refresh', callback_data: 'check_queue' }],
                [{ text: '◀️ Kembali ke Menu', callback_data: 'back_main' }]
            ]
        }
    });
}

/**
 * Helper: Get step description
 */
function getStepDescription(step) {
    const descriptions = {
        'url': 'Input URL',
        'app_name': 'Input nama aplikasi',
        'icon': 'Upload icon',
        'confirm': 'Konfirmasi build',
        'zip_upload': 'Upload file ZIP',
        'zip_type': 'Pilih tipe project',
        'analyze_upload': 'Upload untuk Analyze',
        'cleanup_upload': 'Upload untuk Cleanup'
    };
    return descriptions[step] || step;
}

/**
 * Show Commands Menu - role-based command list
 */
async function showCommandsMenu(bot, chatId, messageId, userInfo) {
    const adminIds = process.env.ADMIN_IDS?.split(',').map(id => id.trim()) || [];
    const isOwner = adminIds.includes(String(userInfo.id));
    const isLicensed = licenseKeyService.isUserAuthorized(userInfo.id);

    let menuMessage = `
📜 <b>DAFTAR PERINTAH</b>
━━━━━━━━━━━━━━━━━━
`;

    if (isOwner) {
        // Owner sees ALL commands
        menuMessage += `
👑 <b>OWNER COMMANDS</b>
━━━━━━━━━━━━━━━━━━

<b>📊 Admin Commands:</b>
/stats - Statistik bot
/broadcast - Broadcast pesan
/listkey - Daftar license keys
/addkey - Tambah license key
/delkey - Hapus license key
/extendkey - Perpanjang license

<b>🔧 Project Tools:</b>
/analyze flutter - Analyze Flutter project
/analyze android - Analyze Android project
/cleanup flutter - Cleanup Flutter project
/cleanup android - Cleanup Android project

<b>📋 General:</b>
/start - Mulai bot
/help - Bantuan
`;
    } else if (isLicensed) {
        // Licensed member sees tools
        menuMessage += `
🎫 <b>MEMBER COMMANDS</b>
━━━━━━━━━━━━━━━━━━

<b>🔧 Project Tools:</b>
/analyze flutter - Analyze Flutter project
/analyze android - Analyze Android project
/cleanup flutter - Cleanup Flutter project
/cleanup android - Cleanup Android project

<b>📋 General:</b>
/start - Mulai bot
/help - Bantuan

💡 <i>Upload file ZIP setelah mengirim command</i>
`;
    } else {
        // Regular user
        menuMessage += `
👤 <b>USER COMMANDS</b>
━━━━━━━━━━━━━━━━━━

<b>📋 General:</b>
/start - Mulai bot
/help - Bantuan

⚠️ <i>Dapatkan license untuk akses tools!</i>
`;
    }

    await bot.deleteMessage(chatId, messageId).catch(() => { });

    await bot.sendMessage(chatId, menuMessage.trim(), {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '◀️ Kembali ke Menu', callback_data: 'back_main' }]
            ]
        }
    });
}

/**
 * Show Thanks To - credits and support
 */
async function showThanksTo(bot, chatId, messageId) {
    const thanksMessage = `
🙏 <b>Thanks You To (TQTO)</b>
━━━━━━━━━━━━━━━━━━

Terima kasih kepada:

👤 <b>Pengguna setia Web2APK</b>
   Kalian yang selalu support kami!

👥 <b>Member komunitas</b>
   Terus berkembang bersama!

⭐ <b>Special thanks to:</b>
   @Otapengenkawin
   <i>Sebagai support development</i>

━━━━━━━━━━━━━━━━━━
💙 <i>Terima kasih sudah menggunakan Web2APK!</i>
    `.trim();

    await bot.deleteMessage(chatId, messageId).catch(() => { });

    await bot.sendMessage(chatId, thanksMessage, {
        parse_mode: 'HTML',
        reply_markup: {
            inline_keyboard: [
                [{ text: '◀️ Kembali ke Menu', callback_data: 'back_main' }]
            ]
        }
    });
}

/**
 * Back to main menu
 */
async function backToMain(bot, chatId, messageId) {
    global.sessions.delete(chatId);

    // Delete old message and send new photo with menu
    await bot.deleteMessage(chatId, messageId).catch(() => { });

    const welcomeCaption = `
🤖 <b>Web2Apk Pro Bot Gen 2</b>

Konversi website menjadi aplikasi Android native dengan mudah!

👇 <b>Klik tombol di bawah untuk memulai:</b>
    `.trim();

    await bot.sendPhoto(chatId, 'https://files.catbox.moe/5z33zb.jpg', {
        caption: welcomeCaption,
        parse_mode: 'HTML',
        reply_markup: getMainKeyboard()
    }).catch(async () => {
        // Fallback if photo fails
        await bot.sendMessage(chatId, welcomeCaption, {
            parse_mode: 'HTML',
            reply_markup: getMainKeyboard()
        });
    });
}

/**
 * Cancel current process
 */
async function cancelProcess(bot, chatId, messageId) {
    const session = global.sessions.get(chatId);

    // Clean up icon if exists
    if (session?.data?.iconPath) {
        await fs.remove(session.data.iconPath).catch(() => { });
    }

    global.sessions.delete(chatId);

    await bot.editMessageText('❌ Proses dibatalkan.\n\nKlik tombol di bawah untuk memulai lagi.', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: getMainKeyboard()
    });
}

/**
 * Skip icon upload
 */
async function skipIcon(bot, chatId, messageId) {
    const session = global.sessions.get(chatId);
    if (!session) return;

    session.step = 'confirm';
    global.sessions.set(chatId, session);

    const message = `
📱 *Konfirmasi Pembuatan APK*

*Detail Aplikasi:*
🌐 URL: ${session.data.url}
📝 Nama: ${session.data.appName}
🖼️ Icon: Default

Klik "✅ Buat APK" untuk memulai proses build.
    `.trim();

    await bot.editMessageText(message, {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'Markdown',
        reply_markup: getConfirmKeyboard()
    });
}

/**
 * Confirm and start build
 */
async function confirmBuild(bot, chatId, messageId) {
    const session = global.sessions.get(chatId);
    if (!session) return;

    // Check if build queue is busy
    if (!buildQueue.acquire(chatId)) {
        const currentBuild = buildQueue.getCurrentBuild();
        const waitTime = currentBuild ? Math.round(currentBuild.duration / 1000) : 0;

        await bot.editMessageText(`
⏳ <b>Server Sedang Sibuk</b>
━━━━━━━━━━━━━━━━━━

🔨 Ada build yang sedang berjalan.
⏱️ Sudah berjalan: <b>${Math.floor(waitTime / 60)}m ${waitTime % 60}s</b>

💡 <i>Silakan coba lagi setelah build selesai.</i>
        `.trim(), {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: getMainKeyboard()
        });

        // Clean up session
        if (session?.data?.iconPath) {
            await fs.remove(session.data.iconPath).catch(() => { });
        }
        global.sessions.delete(chatId);
        return;
    }

    let currentProgress = 0;
    let buildResult = null; // Track result for cleanup in finally

    // Initial build message with progress bar
    await bot.editMessageText(formatBuildStartMessage(session.data.appName, session.data.url), {
        chat_id: chatId,
        message_id: messageId,
        parse_mode: 'HTML'
    });

    try {
        // Build APK with progress updates
        buildResult = await buildApk(session.data, (status) => {
            // Update queue activity timestamp to prevent false inactivity timeout
            buildQueue.updateActivity();

            // Update progress (estimate based on status)
            if (status.includes('Preparing')) currentProgress = 10;
            else if (status.includes('Generating')) currentProgress = 25;
            else if (status.includes('Copying')) currentProgress = 40;
            else if (status.includes('Configuring')) currentProgress = 55;
            else if (status.includes('Building') || status.includes('Gradle')) currentProgress = 70;
            else if (status.includes('Packaging')) currentProgress = 85;
            else if (status.includes('Complete') || status.includes('Success')) currentProgress = 100;
            else currentProgress = Math.min(currentProgress + 5, 95);

            bot.editMessageText(formatBuildProgress(currentProgress, status, session.data.appName), {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML'
            }).catch(() => { });
        });

        if (buildResult.success) {
            // Success message
            await bot.editMessageText(formatSuccessMessage(session.data.appName, session.data.url), {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: 'HTML'
            });

            await bot.sendDocument(chatId, buildResult.apkPath, {
                caption: `✅ <b>${session.data.appName}</b>\n\n🌐 <code>${session.data.url}</code>\n\n<i>Generated by Web2APK Bot</i>`,
                parse_mode: 'HTML'
            });

            // Show success message with main menu
            await bot.sendMessage(chatId, '🎉 APK berhasil dikirim!\n\nIngin membuat APK lagi?', {
                reply_markup: getMainKeyboard()
            });

            // Send report to admin
            sendBuildReport(bot, {
                id: chatId,
                name: session.userName || 'Unknown',
                username: session.userUsername || null
            }, session.data);

        } else {
            throw new Error(buildResult.error);
        }

    } catch (error) {
        console.error('Build error:', error);
        await bot.editMessageText(formatErrorMessage(error.message), {
            chat_id: chatId,
            message_id: messageId,
            parse_mode: 'HTML',
            reply_markup: getMainKeyboard()
        });
    } finally {
        // ALWAYS cleanup - this runs whether success or error

        // Clean up APK file
        if (buildResult?.apkPath) {
            await fs.remove(buildResult.apkPath).catch(() => { });
            console.log(`🗑️ Cleaned APK: ${buildResult.apkPath}`);
        }

        // Clean up temp build directory
        if (buildResult?.buildDir) {
            await fs.remove(buildResult.buildDir).catch(() => { });
            console.log(`🗑️ Cleaned temp dir: ${buildResult.buildDir}`);
        }

        // Clean up uploaded icon
        if (session?.data?.iconPath) {
            await fs.remove(session.data.iconPath).catch(() => { });
        }

        // Release build queue lock
        buildQueue.release(chatId);

        // Clean up session
        global.sessions.delete(chatId);
    }
}

/**
 * Start ZIP project build flow
 */
async function startBuildZip(bot, chatId, messageId) {
    // Check if user has access to ZIP build feature
    const ADMIN_IDS = (process.env.ADMIN_IDS || '').split(',').map(id => id.trim());
    const licenseKeyService = require('../utils/licenseKeyService');

    const isAdmin = ADMIN_IDS.includes(String(chatId));
    const hasLicense = licenseKeyService.isUserAuthorized(chatId);

    if (!isAdmin && !hasLicense) {
        await bot.deleteMessage(chatId, messageId).catch(() => { });
        return bot.sendMessage(chatId, `
🔒 <b>Fitur Khusus Member</b>
━━━━━━━━━━━━━━━━━━

Fitur <b>Build Project ZIP</b> hanya tersedia untuk:
• Admin/Owner
• Member dengan License Key

💡 Hubungi @Izalnotdev untuk mendapatkan akses.
        `.trim(), {
            parse_mode: 'HTML',
            reply_markup: getMainKeyboard()
        });
    }

    await bot.deleteMessage(chatId, messageId).catch(() => { });

    const message = `
📦 <b>Build APK dari Project ZIP</b>
━━━━━━━━━━━━━━━━━━

Pilih jenis project yang akan di-build:

<b>🤖 Android Studio</b>
Project dengan <code>build.gradle</code>

<b>💙 Flutter</b>
Project dengan <code>pubspec.yaml</code>
    `.trim();

    await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: getZipTypeKeyboard()
    });
}

/**
 * Handle ZIP type selection
 */
async function selectZipType(bot, chatId, messageId, projectType) {
    global.sessions.set(chatId, {
        step: 'zip_buildtype',
        data: {
            projectType: projectType,
            buildType: null,
            zipPath: null
        }
    });

    await bot.deleteMessage(chatId, messageId).catch(() => { });

    const typeName = projectType === 'flutter' ? 'Flutter' : 'Android Studio';
    const message = `
📦 <b>Project: ${typeName}</b>
━━━━━━━━━━━━━━━━━━

Pilih tipe build:

<b>🐛 Debug</b> - Build cepat untuk testing
<b>🚀 Release</b> - Build untuk produksi
    `.trim();

    await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: getZipBuildTypeKeyboard()
    });
}

/**
 * Handle build type selection
 */
async function selectZipBuildType(bot, chatId, messageId, buildType) {
    const session = global.sessions.get(chatId);
    if (!session) return;

    session.data.buildType = buildType;
    session.step = 'zip_upload';
    global.sessions.set(chatId, session);

    await bot.deleteMessage(chatId, messageId).catch(() => { });

    const typeName = session.data.projectType === 'flutter' ? 'Flutter' : 'Android';
    const message = `
📤 <b>Upload Project ZIP</b>
━━━━━━━━━━━━━━━━━━

<b>Project:</b> ${typeName}
<b>Build:</b> ${buildType === 'release' ? '🚀 Release' : '🐛 Debug'}

Silakan kirim file <b>.zip</b> project Anda.

<i>⚠️ Pastikan project sudah bisa di-build sebelumnya.</i>
    `.trim();

    await bot.sendMessage(chatId, message, {
        parse_mode: 'HTML',
        reply_markup: getCancelKeyboard()
    });
}

/**
 * Handle ZIP file upload and build
 */
async function handleZipUpload(bot, chatId, filePath) {
    const session = global.sessions.get(chatId);
    if (!session || session.step !== 'zip_upload') return false;

    const { projectType, buildType } = session.data;

    // Check if build queue is busy
    if (!buildQueue.acquire(chatId)) {
        const currentBuild = buildQueue.getCurrentBuild();
        const waitTime = currentBuild ? Math.round(currentBuild.duration / 1000) : 0;

        await bot.sendMessage(chatId, `
⏳ <b>Server Sedang Sibuk</b>
━━━━━━━━━━━━━━━━━━

🔨 Ada build yang sedang berjalan.
⏱️ Sudah berjalan: <b>${Math.floor(waitTime / 60)}m ${waitTime % 60}s</b>

💡 <i>Silakan coba lagi setelah build selesai.</i>
        `.trim(), {
            parse_mode: 'HTML',
            reply_markup: getMainKeyboard()
        });

        // Cleanup uploaded file
        await fs.remove(filePath).catch(() => { });
        global.sessions.delete(chatId);
        return true;
    }

    let currentProgress = 0;

    const statusMsg = await bot.sendMessage(chatId,
        formatZipBuildProgress(0, 'Memulai proses build...', projectType, buildType),
        { parse_mode: 'HTML' }
    );

    try {
        const result = await buildFromZip(
            filePath,
            projectType,
            buildType,
            (status) => {
                // Update progress based on status
                if (status.includes('Extracting')) currentProgress = 10;
                else if (status.includes('Cleaning')) currentProgress = 20;
                else if (status.includes('dependencies') || status.includes('Getting')) currentProgress = 35;
                else if (status.includes('Building') || status.includes('Gradle')) currentProgress = 60;
                else if (status.includes('Locating') || status.includes('APK')) currentProgress = 90;
                else currentProgress = Math.min(currentProgress + 5, 95);

                bot.editMessageText(
                    formatZipBuildProgress(currentProgress, status, projectType, buildType), {
                    chat_id: chatId,
                    message_id: statusMsg.message_id,
                    parse_mode: 'HTML'
                }).catch(() => { });
            }
        );

        if (result.success) {
            const typeName = projectType === 'flutter' ? 'Flutter' : 'Android';
            const buildName = buildType === 'release' ? 'Release' : 'Debug';

            // Check file size before sending
            // Local Bot API: 2GB limit, Standard Bot API: 50MB limit
            const MAX_FILE_SIZE = process.env.LOCAL_API_URL
                ? 2 * 1024 * 1024 * 1024  // 2GB with Local Bot API
                : 50 * 1024 * 1024;        // 50MB with standard Bot API
            const apkStats = await fs.stat(result.apkPath);
            const fileSizeMB = (apkStats.size / (1024 * 1024)).toFixed(2);

            if (apkStats.size > MAX_FILE_SIZE) {
                // APK too large for Telegram - provide download link via web server
                const WEB_URL = process.env.WEB_URL || `http://localhost:${process.env.WEB_PORT || 3000}`;
                const buildId = `tg-zip-${Date.now()}`;

                // Register APK for download (expiry: 5 minutes for large files)
                const { registerBuildForDownload } = require('../server');
                registerBuildForDownload(buildId, result.apkPath, result.buildDir, `${typeName}_${buildName}.apk`, 5 * 60 * 1000);

                const downloadUrl = `${WEB_URL}/api/download/${buildId}`;

                await bot.editMessageText(`
✅ <b>Build Berhasil!</b>
━━━━━━━━━━━━━━━━━━

📱 <b>Type:</b> ${typeName}
🏷️ <b>Build:</b> ${buildName}
📦 <b>Ukuran:</b> ${fileSizeMB} MB

⚠️ <b>File terlalu besar untuk Telegram (>50MB)</b>

🔗 <b>Download via Link:</b>
<code>${downloadUrl}</code>

⏰ <i>Link berlaku 5 menit</i>
                `.trim(), {
                    chat_id: chatId,
                    message_id: statusMsg.message_id,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: '📥 Download APK', url: downloadUrl }],
                            [{ text: '◀️ Kembali ke Menu', callback_data: 'back_main' }]
                        ]
                    }
                });

                return true;
            }

            await bot.editMessageText(`
✅ <b>Build Berhasil!</b>
━━━━━━━━━━━━━━━━━━

📱 <b>Type:</b> ${typeName}
🏷️ <b>Build:</b> ${buildName}
📦 <b>Ukuran:</b> ${fileSizeMB} MB

🎉 <i>Mengirim file APK...</i>
            `.trim(), {
                chat_id: chatId,
                message_id: statusMsg.message_id,
                parse_mode: 'HTML'
            });

            await bot.sendDocument(chatId, result.apkPath, {
                caption: `✅ <b>APK Build Success</b>\n\n📱 <b>Type:</b> ${typeName}\n🏷️ <b>Build:</b> ${buildName}\n📦 <b>Size:</b> ${fileSizeMB} MB\n\n<i>Generated by Web2APK Bot</i>`,
                parse_mode: 'HTML'
            });

            // Cleanup
            await fs.remove(result.apkPath).catch(() => { });
            await fs.remove(result.buildDir).catch(() => { });

            await bot.sendMessage(chatId, '🎉 APK berhasil di-build!\n\nIngin build lagi?', {
                reply_markup: getMainKeyboard()
            });
        } else {
            throw new Error(result.error);
        }

    } catch (error) {
        console.error('ZIP Build error:', error);
        await bot.editMessageText(formatErrorMessage(error.message), {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: 'HTML',
            reply_markup: getMainKeyboard()
        });
    }

    // Release build queue lock
    buildQueue.release(chatId);
    global.sessions.delete(chatId);
    return true;
}

module.exports = { handleCallback, handleZipUpload };

