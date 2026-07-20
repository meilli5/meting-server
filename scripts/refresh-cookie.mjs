/**
 * QQ Music Cookie 自动刷新脚本
 *
 * 原理：
 *   qqmusic_key 有效期只有 ~2 天，但 QQ 登录态（uin、skey 等）可以持续数周。
 *   此脚本用 Playwright 维护一个持久化浏览器配置，保存 QQ 登录态。
 *   每次运行时访问 y.qq.com，浏览器会自动用已保存的 QQ 登录态换取新的 qqmusic_key。
 *   首次运行需要手动扫码登录，之后无需人工介入。
 *
 * 用法：
 *   node scripts/refresh-cookie.mjs              # 提取 cookie 并保存到文件
 *   node scripts/refresh-cookie.mjs --update     # 提取 cookie 并尝试更新 Railway/VPS
 *   node scripts/refresh-cookie.mjs --force-login # 跳过已保存的登录态，重新登录
 *
 * 前置条件：
 *   pnpm add -D playwright
 *   npx playwright install chromium
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROFILE_DIR = path.join(__dirname, "..", ".browser-profile");
const COOKIE_FILE = path.join(__dirname, "..", ".tencent-cookie");

const QQ_MUSIC_URL = "https://y.qq.com";
const COOKIE_DOMAINS = [".y.qq.com", ".qq.com", "y.qq.com", "qq.com"];

// ── 工具函数 ────────────────────────────────────────────────

/** 从 playwright cookie 数组提取需要的 cookie，格式化为 HTTP Cookie 字符串 */
function formatCookies(cookies) {
	// 只保留相关域名的 cookie
	const relevant = cookies.filter((c) =>
		COOKIE_DOMAINS.some((d) => c.domain === d || c.domain.endsWith(d)),
	);

	// 去重（同 name 保留 path 最长的）
	const seen = new Map();
	for (const c of relevant) {
		const existing = seen.get(c.name);
		if (!existing || c.path.length > existing.path.length) {
			seen.set(c.name, c);
		}
	}

	return Array.from(seen.values())
		.map((c) => `${c.name}=${c.value}`)
		.join("; ");
}

/** 检测页面是否已登录 QQ 音乐 */
async function checkLoginStatus(page) {
	try {
		// 方法 1：检查是否存在用户头像/昵称元素
		const avatar = await page.$('[class*="avatar"], [class*="headimg"], .user_avatar, #user_avatar');
		// 方法 2：检查 cookies 中是否有 qqmusic_key
		const cookies = await page.context().cookies();
		const hasMusicKey = cookies.some((c) => c.name === "qqmusic_key");
		// 方法 3：检查页面是否还有"登录"按钮
		const loginBtn = await page.$('a:has-text("登录"), [class*="login"]');

		return hasMusicKey || (avatar !== null && loginBtn === null);
	} catch {
		return false;
	}
}

/** 等待用户手动登录 */
async function waitForLogin(page) {
	console.log("⏳ 请在浏览器窗口中完成登录（扫码或账号密码）...");
	console.log("   等待中（超时 5 分钟）...\n");

	try {
		// 等待 qqmusic_key cookie 出现，最长等 5 分钟
		await page.waitForFunction(
			() => document.cookie.includes("qqmusic_key"),
			{ timeout: 300_000 },
		);
		console.log("✅ 检测到登录成功！");
		// 再等几秒确保所有 cookie 都写入
		await page.waitForTimeout(3000);
	} catch {
		console.error("❌ 登录超时（5 分钟），请重试");
		process.exit(1);
	}
}

/** 简单检测 cookie 字符串是否有效 */
function quickCheck(cookieStr) {
	const uin = cookieStr.match(/uin=o?0*(\d+)/);
	const key = cookieStr.match(/qqmusic_key=/);
	return {
		hasUin: !!uin,
		uin: uin ? uin[1] : null,
		hasMusicKey: !!key,
		totalLength: cookieStr.length,
	};
}

// ── 主流程 ──────────────────────────────────────────────────

async function main() {
	const args = process.argv.slice(2);
	const forceLogin = args.includes("--force-login");
	const shouldUpdate = args.includes("--update");
	const headless = args.includes("--headless");

	console.log("🎵 Firefly QQ Music Cookie 刷新工具\n");

	// headless 模式：不能扫码，必须有已保存的登录态
	if (headless && !fs.existsSync(PROFILE_DIR)) {
		console.error("❌ 无头模式需要先手动运行一次以保存登录态：");
		console.error("   node scripts/refresh-cookie.mjs");
		process.exit(1);
	}

	// 如果是强制重新登录，删除旧 profile（无头模式不允许）
	if (forceLogin) {
		if (headless) {
			console.error("❌ 无头模式不支持 --force-login");
			process.exit(1);
		}
		if (fs.existsSync(PROFILE_DIR)) {
			fs.rmSync(PROFILE_DIR, { recursive: true });
			console.log("🗑️  已清除旧的浏览器配置\n");
		}
	}

	// 启动持久化浏览器上下文
	console.log(`🌐 启动浏览器（${headless ? "无头" : "可见"}模式）...`);
	const context = await chromium.launchPersistentContext(PROFILE_DIR, {
		headless,
		viewport: { width: 1280, height: 800 },
		userAgent:
			"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
		permissions: [],
	});

	const page = await context.newPage();

	try {
		// 访问 QQ 音乐首页
		console.log("📄 正在访问 y.qq.com ...");
		await page.goto(QQ_MUSIC_URL, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});

		// 等待页面稳定
		await page.waitForTimeout(2000);

		// 检测登录状态
		const isLoggedIn = await checkLoginStatus(page);

		if (isLoggedIn) {
			console.log("✅ 检测到已保存的登录态\n");
		} else if (headless) {
			console.error("❌ 无头模式下检测到登录态已过期，请手动运行：");
			console.error("   node scripts/refresh-cookie.mjs");
			process.exit(1);
		} else {
			console.log("⚠️  未检测到有效的 QQ 登录态\n");
			await waitForLogin(page);
		}

		// 额外刷新一下页面，确保 qqmusic_key 被更新
		console.log("🔄 刷新页面以触发 cookie 更新...");
		await page.reload({ waitUntil: "domcontentloaded" });
		await page.waitForTimeout(3000);

		// 提取 cookies
		const allCookies = await context.cookies();
		const cookieStr = formatCookies(allCookies);
		const info = quickCheck(cookieStr);

		console.log("\n📋 Cookie 信息：");
		console.log(`   - UIN: ${info.uin || "未找到"}`);
		console.log(`   - qqmusic_key: ${info.hasMusicKey ? "✅ 已获取" : "❌ 未找到"}`);
		console.log(`   - 总长度: ${info.totalLength} 字符`);

		if (!info.hasMusicKey) {
			console.error("\n❌ 未能获取 qqmusic_key，请检查登录状态");
			process.exit(1);
		}

		// 保存到文件
		fs.writeFileSync(COOKIE_FILE, cookieStr);
		console.log(`\n💾 Cookie 已保存到: ${COOKIE_FILE}`);

		// 打印 cookie（截短显示）
		console.log("\n📋 Cookie 内容（前 100 字符）：");
		console.log(`   ${cookieStr.slice(0, 100)}...`);

		// ── 更新远程环境变量 ──────────────────────────────────
		if (shouldUpdate) {
			await updateRemote(cookieStr);
		} else {
			console.log("\n💡 提示：运行以下命令将 cookie 推送到远程服务器：");
			console.log("   node scripts/refresh-cookie.mjs --update");
		}

		console.log("\n✅ 完成！");
	} catch (e) {
		console.error("\n❌ 出错:", e.message);
		process.exit(1);
	} finally {
		await context.close();
	}
}

// ── 更新远程环境变量 ────────────────────────────────────────

async function updateRemote(cookieStr) {
	console.log("\n📤 更新远程环境变量...\n");

	// 方式 1: Railway CLI
	try {
		const { execSync } = await import("node:child_process");
		const which = execSync("which railway 2>/dev/null || echo ''", { encoding: "utf-8" }).trim();

		if (which) {
			console.log("🔧 检测到 Railway CLI，正在更新...");
			execSync(
				`railway variables set METING_TENCENT_COOKIE="${cookieStr}"`,
				{ stdio: "inherit" },
			);
			console.log("✅ Railway 环境变量已更新，服务将自动重新部署\n");
			return;
		}
	} catch {
		console.log("⚠️  Railway CLI 未安装或不在 PATH 中");
	}

	// 方式 2: 环境变量文件（方便手动操作）
	const envFile = path.join(__dirname, "..", ".env");
	let envContent = "";
	if (fs.existsSync(envFile)) {
		envContent = fs.readFileSync(envFile, "utf-8");
	}
	// 更新或追加 METING_TENCENT_COOKIE
	if (envContent.includes("METING_TENCENT_COOKIE=")) {
		envContent = envContent.replace(
			/METING_TENCENT_COOKIE=.*/,
			`METING_TENCENT_COOKIE=${cookieStr}`,
		);
	} else {
		envContent += `\nMETING_TENCENT_COOKIE=${cookieStr}\n`;
	}
	fs.writeFileSync(envFile, envContent);
	console.log("📝 已更新本地 .env 文件");

	console.log("\n💡 手动更新方式：");
	console.log("   Railway Dashboard → 项目 → Variables → 更新 METING_TENCENT_COOKIE");
	console.log("   VPS: SSH 登录后更新 .env 文件，重启服务\n");
}

// ── 入口 ────────────────────────────────────────────────────

main();
