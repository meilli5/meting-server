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
 *   node scripts/refresh-cookie.mjs --update     # 提取 cookie 并推送到 Railway
 *   node scripts/refresh-cookie.mjs --force-login # 跳过已保存的登录态，重新登录
 *   node scripts/refresh-cookie.mjs --headless --update  # 无头 + 自动推送
 *
 * Railway 全自动推送配置（只需一次）：
 *   在 .env 中设置以下四个变量：
 *     RAILWAY_API_TOKEN      — https://railway.app/account/tokens 创建
 *     RAILWAY_PROJECT_ID     — 项目 Settings → General
 *     RAILWAY_ENVIRONMENT_ID — 项目 Variables 页面 URL 中的 environmentId
 *     RAILWAY_SERVICE_ID     — 项目 Service 页面 URL 末尾的 ID
 */

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_DIR = path.join(__dirname, "..");
const PROFILE_DIR = path.join(PROJECT_DIR, ".browser-profile");
const COOKIE_FILE = path.join(PROJECT_DIR, ".tencent-cookie");
const ENV_FILE = path.join(PROJECT_DIR, ".env");

const QQ_MUSIC_URL = "https://y.qq.com";
const COOKIE_DOMAINS = [".y.qq.com", ".qq.com", "y.qq.com", "qq.com"];

// ── 加载本地 .env ────────────────────────────────────────────

function loadEnv() {
	if (!fs.existsSync(ENV_FILE)) return;
	const lines = fs.readFileSync(ENV_FILE, "utf-8").split("\n");
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;
		const eq = trimmed.indexOf("=");
		if (eq === -1) continue;
		const key = trimmed.slice(0, eq).trim();
		const value = trimmed.slice(eq + 1).trim();
		if (key && !process.env[key]) {
			process.env[key] = value;
		}
	}
}

loadEnv();

// ── 工具函数 ────────────────────────────────────────────────

function formatCookies(cookies) {
	const relevant = cookies.filter((c) =>
		COOKIE_DOMAINS.some((d) => c.domain === d || c.domain.endsWith(d)),
	);
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

async function checkLoginStatus(page) {
	try {
		const avatar = await page.$('[class*="avatar"], [class*="headimg"], .user_avatar, #user_avatar');
		const cookies = await page.context().cookies();
		const hasMusicKey = cookies.some((c) => c.name === "qqmusic_key");
		const loginBtn = await page.$('a:has-text("登录"), [class*="login"]');
		return hasMusicKey || (avatar !== null && loginBtn === null);
	} catch {
		return false;
	}
}

async function waitForLogin(page) {
	console.log("⏳ 请在浏览器窗口中完成登录（扫码或账号密码）...");
	console.log("   等待中（超时 5 分钟）...\n");
	try {
		await page.waitForFunction(
			() => document.cookie.includes("qqmusic_key"),
			{ timeout: 300_000 },
		);
		console.log("✅ 检测到登录成功！");
		await page.waitForTimeout(3000);
	} catch {
		console.error("❌ 登录超时（5 分钟），请重试");
		process.exit(1);
	}
}

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

// ── Railway GraphQL API ──────────────────────────────────────

async function updateRailwayViaApi(cookieStr) {
	const token = process.env.RAILWAY_API_TOKEN;
	const projectId = process.env.RAILWAY_PROJECT_ID;
	const environmentId = process.env.RAILWAY_ENVIRONMENT_ID;
	const serviceId = process.env.RAILWAY_SERVICE_ID;

	if (!token || !projectId || !environmentId || !serviceId) {
		return { ok: false, reason: "缺少 Railway API 配置" };
	}

	const res = await fetch("https://backboard.railway.app/graphql/v2", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify({
			query: "mutation variableUpsert($input: VariableUpsertInput!) { variableUpsert(input: $input) }",
			variables: {
				input: {
					projectId,
					environmentId,
					serviceId,
					name: "METING_TENCENT_COOKIE",
					value: cookieStr,
				},
			},
		}),
	});

	const body = await res.json();
	if (body.errors) {
		return { ok: false, reason: body.errors[0]?.message || JSON.stringify(body.errors) };
	}
	return { ok: true };
}

async function updateRailwayViaCli(cookieStr) {
	try {
		const { execSync } = await import("node:child_process");
		const which = execSync("which railway 2>/dev/null || echo ''", {
			encoding: "utf-8",
		}).trim();
		if (!which) return false;

		console.log("🔧 检测到 Railway CLI，正在更新...");
		execSync(`railway variables set METING_TENCENT_COOKIE="${cookieStr}"`, {
			stdio: "inherit",
		});
		console.log("✅ Railway 环境变量已更新，服务将自动重新部署\n");
		return true;
	} catch {
		return false;
	}
}

function updateLocalEnv(cookieStr) {
	let content = "";
	if (fs.existsSync(ENV_FILE)) {
		content = fs.readFileSync(ENV_FILE, "utf-8");
	}
	if (content.includes("METING_TENCENT_COOKIE=")) {
		content = content.replace(
			/METING_TENCENT_COOKIE=.*(\r?\n|$)/,
			`METING_TENCENT_COOKIE=${cookieStr}$1`,
		);
	} else {
		content = content.trimEnd() + `\nMETING_TENCENT_COOKIE=${cookieStr}\n`;
	}
	fs.writeFileSync(ENV_FILE, content);
}

// ── 推送远程 ─────────────────────────────────────────────────

async function updateRemote(cookieStr) {
	console.log("\n📤 推送 Cookie 到远程服务器...\n");

	// ① Railway GraphQL API（推荐，无需 CLI）
	const apiResult = await updateRailwayViaApi(cookieStr);
	if (apiResult.ok) {
		console.log("✅ 已通过 Railway API 更新环境变量 → Railway 将自动重新部署\n");
		return;
	}
	if (apiResult.reason !== "缺少 Railway API 配置") {
		console.log(`⚠️  Railway API 失败: ${apiResult.reason}`);
	}

	// ② Railway CLI 备用
	const cliOk = await updateRailwayViaCli(cookieStr);
	if (cliOk) return;

	// ③ 兜底：更新本地 .env
	updateLocalEnv(cookieStr);
	console.log("📝 已更新本地 .env 文件");

	if (apiResult.reason === "缺少 Railway API 配置") {
		console.log("\n⚠️  未配置 Railway API Token，无法自动推送。\n");
		console.log("💡 配置一次即可实现全自动推送：\n");
		console.log("   1️⃣  https://railway.app/account/tokens → 创建 API Token");
		console.log("   2️⃣  打开 Railway 项目 → Settings → General");
		console.log("       复制 Project ID 和 Environment ID");
		console.log("   3️⃣  点击你的 Service → 复制 URL 末尾的 Service ID");
		console.log("   4️⃣  将以下内容写入 meting-server/.env：\n");
		console.log("        RAILWAY_API_TOKEN=<第1步的token>");
		console.log("        RAILWAY_PROJECT_ID=<第2步的Project ID>");
		console.log("        RAILWAY_ENVIRONMENT_ID=<第2步的Environment ID>");
		console.log("        RAILWAY_SERVICE_ID=<第3步的Service ID>\n");
		console.log("   完成后再次运行 ./scripts/refresh-cookie.sh --auto 即可验证！");
	}
}

// ── 主流程 ──────────────────────────────────────────────────

async function main() {
	const args = process.argv.slice(2);
	const forceLogin = args.includes("--force-login");
	const shouldUpdate = args.includes("--update");
	const headless = args.includes("--headless");

	console.log("🎵 Firefly QQ Music Cookie 刷新工具\n");

	if (headless && !fs.existsSync(PROFILE_DIR)) {
		console.error("❌ 无头模式需要先手动运行一次以保存登录态：");
		console.error("   node scripts/refresh-cookie.mjs");
		process.exit(1);
	}

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
		console.log("📄 正在访问 y.qq.com ...");
		await page.goto(QQ_MUSIC_URL, {
			waitUntil: "domcontentloaded",
			timeout: 30_000,
		});
		await page.waitForTimeout(2000);

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

		console.log("🔄 刷新页面以触发 cookie 更新...");
		await page.reload({ waitUntil: "domcontentloaded" });
		await page.waitForTimeout(3000);

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

		fs.writeFileSync(COOKIE_FILE, cookieStr);
		console.log(`\n💾 Cookie 已保存到: ${COOKIE_FILE}`);
		console.log(`   ${cookieStr.slice(0, 100)}...`);

		if (shouldUpdate) {
			await updateRemote(cookieStr);
		} else {
			console.log("\n💡 推送到 Railway 请加 --update 参数");
			console.log("   完整自动: node scripts/refresh-cookie.mjs --headless --update");
		}

		console.log("\n✅ 完成！");
	} catch (e) {
		console.error("\n❌ 出错:", e.message);
		process.exit(1);
	} finally {
		await context.close();
	}
}

main();
