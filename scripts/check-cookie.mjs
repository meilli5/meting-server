/**
 * QQ Music Cookie 有效性检测脚本
 *
 * 用法：
 *   node scripts/check-cookie.mjs                    # 检测 .tencent-cookie 文件中的 cookie
 *   node scripts/check-cookie.mjs <cookie-string>    # 检测指定 cookie 字符串
 *   node scripts/check-cookie.mjs --server <url>      # 检测远程服务器的 cookie 状态
 */

const DEFAULT_SONG = "004brgH30hf6h6"; // 测试用歌曲 (Night of Bloom)

function extractUin(cookie) {
	const m = cookie.match(/uin=o?0*(\d+)/);
	return m ? m[1] : "0";
}

function randomGuid() {
	return String(Math.floor(Math.random() * 9000000000) + 1000000000);
}

async function testCookie(cookie, label) {
	const uin = extractUin(cookie);
	console.log(`\n🔍 检测: ${label}`);
	console.log(`   UIN: ${uin}`);
	console.log(`   Cookie 长度: ${cookie.length} 字符`);

	try {
		const res = await fetch("https://u.y.qq.com/cgi-bin/musicu.fcg", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: cookie,
				Referer: "https://y.qq.com",
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
			},
			body: JSON.stringify({
				req_0: {
					module: "vkey.GetVkeyServer",
					method: "CgiGetVkey",
					param: {
						guid: randomGuid(),
						songmid: [DEFAULT_SONG],
						songtype: [0],
						uin,
						loginflag: 1,
						platform: "20",
					},
				},
			}),
		});

		const data = await res.json();
		const midurlinfo = data?.req_0?.data?.midurlinfo?.[0];
		const purl = midurlinfo?.purl;
		const sip = data?.req_0?.data?.sip?.[0] || "";

		if (purl) {
			console.log(`   ✅ 有效！purl: ${purl}`);
			console.log(`   🎵 测试音频: ${sip}${purl}`);
		} else {
			console.log("   ❌ 无效：purl 为空，cookie 可能已过期");
			if (data?.req_0?.code) {
				console.log(`   错误码: ${data.req_0.code}`);
			}
		}
		return !!purl;
	} catch (e) {
		console.log(`   ❌ 检测失败: ${e.message}`);
		return false;
	}
}

async function checkServer(url) {
	console.log(`\n🌐 检测远程服务器: ${url}`);
	try {
		const res = await fetch(`${url.replace(/\/$/, "")}/api/health`);
		const data = await res.json();
		console.log(JSON.stringify(data, null, 2));
	} catch (e) {
		console.log(`   ❌ 无法连接: ${e.message}`);
	}
}

// ── 主入口 ──────────────────────────────────────────────────

const arg = process.argv[2];

if (arg === "--server" || arg === "-s") {
	const url = process.argv[3];
	if (!url) {
		console.log("用法: node scripts/check-cookie.mjs --server <服务器URL>");
		process.exit(1);
	}
	await checkServer(url);
} else if (arg && !arg.startsWith("--")) {
	// 直接传入 cookie 字符串
	await testCookie(arg, "命令行参数传入的 Cookie");
} else {
	// 从文件读取
	import("node:fs").then(async (fs) => {
		import("node:path").then(async (path) => {
			const { fileURLToPath } = await import("node:url");
			const __dirname = path.dirname(fileURLToPath(import.meta.url));
			const cookieFile = path.join(__dirname, "..", ".tencent-cookie");

			if (!fs.existsSync(cookieFile)) {
				console.log("❌ 未找到 .tencent-cookie 文件");
				console.log("   请先运行: node scripts/refresh-cookie.mjs");
				console.log("   或手动传入: node scripts/check-cookie.mjs <cookie字符串>");
				process.exit(1);
			}

			const cookie = fs.readFileSync(cookieFile, "utf-8").trim();
			await testCookie(cookie, `.tencent-cookie 文件`);
		});
	});
}
