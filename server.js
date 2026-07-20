import express from "express";
import cors from "cors";
import Meting from "@meting/core";

const PORT = process.env.PORT || 3000;

// 从环境变量读取各平台 cookie
const PLATFORM_COOKIES = {
	tencent: process.env.METING_TENCENT_COOKIE || "",
	netease: process.env.METING_NETEASE_COOKIE || "",
	kugou: process.env.METING_KUGOU_COOKIE || "",
};

const app = express();
app.use(cors());

// ═══════════════════════════════════════════════════════════════
// Cookie 健康状态追踪
// ═══════════════════════════════════════════════════════════════
const COOKIE_HEALTH = {
	tencent: { valid: null, lastCheck: null, error: null, purl: null },
	netease: { valid: null, lastCheck: null, error: null },
	kugou: { valid: null, lastCheck: null, error: null },
};

/** 测试 QQ Music cookie 是否有效：用一首已知歌曲试试能不能拿到 purl */
async function checkTencentCookie() {
	const cookie = PLATFORM_COOKIES.tencent;
	if (!cookie) {
		COOKIE_HEALTH.tencent = { valid: false, lastCheck: Date.now(), error: "未配置 cookie", purl: null };
		return;
	}

	try {
		const vkeyBody = {
			req_0: {
				module: "vkey.GetVkeyServer",
				method: "CgiGetVkey",
				param: {
					guid: randomGuid(),
					songmid: ["004brgH30hf6h6"], // 测试用歌曲
					songtype: [0],
					uin: extractUin(cookie),
					loginflag: 1,
					platform: "20",
				},
			},
		};

		const res = await fetch("https://u.y.qq.com/cgi-bin/musicu.fcg", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Cookie: cookie,
				Referer: "https://y.qq.com",
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
			},
			body: JSON.stringify(vkeyBody),
		});

		const data = await res.json();
		const midurlinfo = data?.req_0?.data?.midurlinfo?.[0];
		const purl = midurlinfo?.purl;

		if (purl) {
			COOKIE_HEALTH.tencent = { valid: true, lastCheck: Date.now(), error: null, purl };
		} else {
			COOKIE_HEALTH.tencent = { valid: false, lastCheck: Date.now(), error: "purl 为空，cookie 可能已过期", purl: null };
		}
	} catch (e) {
		COOKIE_HEALTH.tencent = { valid: false, lastCheck: Date.now(), error: e.message, purl: null };
	}
}

// 启动后 30 秒首次检测，之后每 2 小时检测一次
setTimeout(() => {
	checkTencentCookie();
}, 30_000);

setInterval(() => {
	checkTencentCookie();
}, 2 * 60 * 60 * 1000); // 2 小时

// 健康检查
app.get("/", (_req, res) => {
	const configured = Object.entries(PLATFORM_COOKIES)
		.filter(([, v]) => v)
		.map(([k]) => k);
	res.json({
		status: "ok",
		server: "firefly-meting-api",
		cookies: configured.length ? configured : "none",
	});
});

// Cookie 健康状态查询
app.get("/api/health", (_req, res) => {
	const age = COOKIE_HEALTH.tencent.lastCheck
		? Math.round((Date.now() - COOKIE_HEALTH.tencent.lastCheck) / 1000)
		: null;

	res.json({
		tencent: {
			...COOKIE_HEALTH.tencent,
			lastCheckAgo: age ? `${age}s ago` : "never",
			// 脱敏：只显示 cookie 的前几位
			cookiePreview: PLATFORM_COOKIES.tencent
				? PLATFORM_COOKIES.tencent.slice(0, 30) + "..."
				: null,
		},
	});
});

function getBaseUrl(req) {
	const host = req.get("host") || "localhost:3000";
	const proto = req.get("x-forwarded-proto") || req.protocol || "https";
	return `${proto}://${host}`;
}

function createMeting(server) {
	const meting = new Meting(server);
	const cookie = PLATFORM_COOKIES[server] || "";
	if (cookie) meting.cookie(cookie);
	meting.format(true);
	return meting;
}

function extractUin(cookie) {
	const m = cookie.match(/uin=o?0*(\d+)/);
	return m ? m[1] : "0";
}

function randomGuid() {
	return String(Math.floor(Math.random() * 9000000000) + 1000000000);
}

// ═══════════════════════════════════════════════════════════════
// type=url: 代理音频流（直接调 QQ 音乐 CgiGetVkey + 流式转发）
// ═══════════════════════════════════════════════════════════════
async function handleUrl(res, server, id) {
	const cookie = PLATFORM_COOKIES[server] || "";
	const songmid = String(id);

	const vkeyBody = {
		req_0: {
			module: "vkey.GetVkeyServer",
			method: "CgiGetVkey",
			param: {
				guid: randomGuid(),
				songmid: [songmid],
				songtype: [0],
				uin: extractUin(cookie),
				loginflag: 1,
				platform: "20",
			},
		},
	};

	const vkeyRes = await fetch("https://u.y.qq.com/cgi-bin/musicu.fcg", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Cookie: cookie,
			Referer: "https://y.qq.com",
			Origin: "https://y.qq.com",
			"User-Agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
		},
		body: JSON.stringify(vkeyBody),
	});

	const vkeyData = await vkeyRes.json();
	const midurlinfo = vkeyData?.req_0?.data?.midurlinfo?.[0];
	const purl = midurlinfo?.purl || "";
	const sip = vkeyData?.req_0?.data?.sip?.[0] || "";

	if (!purl) {
		console.error(`[vkey] songmid=${songmid} purl 为空`);
		res.status(403).json({
			error: "歌曲鉴权失败，purl 为空。可能 cookie 已过期",
		});
		return;
	}

	let audioUrl = sip + purl;
	if (audioUrl.startsWith("http://")) {
		audioUrl = audioUrl.replace("http://", "https://");
	}

	console.log(`[vkey] songmid=${songmid} → ${audioUrl.slice(0, 100)}`);

	const audioRes = await fetch(audioUrl, {
		headers: {
			Referer: "https://y.qq.com",
			"User-Agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
		},
	});

	if (!audioRes.ok) {
		res.status(audioRes.status).json({ error: `音频下载失败: ${audioRes.status}` });
		return;
	}

	res.status(audioRes.status);
	res.set("Content-Type", audioRes.headers.get("Content-Type") || "audio/mp4");
	const cl = audioRes.headers.get("Content-Length");
	if (cl) res.set("Content-Length", cl);
	res.set("Accept-Ranges", "bytes");
	res.set("Cache-Control", "public, max-age=3600");

	const reader = audioRes.body.getReader();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		res.write(Buffer.from(value));
	}
	res.end();
}

// ═══════════════════════════════════════════════════════════════
// type=pic: 代理封面图
// ═══════════════════════════════════════════════════════════════
async function handlePic(res, server, id) {
	const meting = new Meting(server);
	const cookie = PLATFORM_COOKIES[server] || "";
	if (cookie) meting.cookie(cookie);
	const result = await meting.pic(id, 300);
	const data = typeof result === "string" ? JSON.parse(result) : result;
	const picUrl = data.url || data;
	if (typeof picUrl === "string" && picUrl.startsWith("http")) {
		res.redirect(302, picUrl);
	} else {
		res.json({ url: picUrl });
	}
}

// ═══════════════════════════════════════════════════════════════
// type=lrc: 返回歌词纯文本
// ═══════════════════════════════════════════════════════════════
async function handleLrc(res, server, id) {
	const meting = new Meting(server);
	const cookie = PLATFORM_COOKIES[server] || "";
	if (cookie) meting.cookie(cookie);
	const result = await meting.lyric(id);
	const data = typeof result === "string" ? JSON.parse(result) : result;
	const lrc = data.lyric || data.lrc || data;
	const text = typeof lrc === "string" ? lrc : JSON.stringify(lrc);
	res.type("text/plain; charset=utf-8");
	res.send(text);
}

// ═══════════════════════════════════════════════════════════════
// API 主路由：统一分发
// ═══════════════════════════════════════════════════════════════
app.get("/api", async (req, res) => {
	const { server, type, id } = req.query;

	if (!server || !type || !id) {
		res.status(400).json({ error: "缺少参数" });
		return;
	}

	try {
		if (type === "url") return await handleUrl(res, server, id);
		if (type === "pic") return await handlePic(res, server, id);
		if (type === "lrc") return await handleLrc(res, server, id);

		// song / playlist / album / search
		const meting = createMeting(server);
		const baseUrl = getBaseUrl(req);

		let rawResult;
		if (type === "search") {
			rawResult = await meting.search(id, { page: 1, limit: 50 });
		} else {
			rawResult = await meting[type](id);
		}

		const data = typeof rawResult === "string" ? JSON.parse(rawResult) : rawResult;
		const list = Array.isArray(data) ? data : [data];

		if (list.length === 0) {
			console.warn(`[${server}] ${type}=${id} 返回了 0 首歌曲`);
			res.json([]);
			return;
		}

		const items = list.map((item) => {
			const urlId = item.url_id || item.id || "";
			const picId = item.pic_id || "";
			const lrcId = item.lyric_id || item.url_id || item.id || "";

			return {
				name: item.name || item.title || "Unknown",
				artist: Array.isArray(item.artist)
					? item.artist.join(" / ")
					: item.artist || "Unknown",
				url: urlId ? `${baseUrl}/api?server=${server}&type=url&id=${urlId}` : "",
				pic: picId ? `${baseUrl}/api?server=${server}&type=pic&id=${picId}` : "",
				lrc: lrcId ? `${baseUrl}/api?server=${server}&type=lrc&id=${lrcId}` : "",
			};
		});

		const sample = items[0];
		console.log(
			`[${server}] ${type}=${id} → ${items.length} 首歌曲` +
				(sample ? ` (${sample.name} - ${sample.artist})` : ""),
		);

		res.json(items);
	} catch (e) {
		console.error(`[${server}] ${type}=${id} 错误:`, e.message);
		if (!res.headersSent) res.status(500).json({ error: e.message });
	}
});

// ═══════════════════════════════════════════════════════════════
// 调试端点
// ═══════════════════════════════════════════════════════════════
app.get("/debug", async (req, res) => {
	const { server, type, id } = req.query;
	if (!server || !type || !id) {
		res.status(400).json({ error: "需要 server, type, id 参数" });
		return;
	}

	try {
		const meting = createMeting(server);

		const playlist = await meting.playlist(id);
		const list = typeof playlist === "string" ? JSON.parse(playlist) : playlist;

		let urlTest = null;
		const firstSong = Array.isArray(list) && list.length > 0 ? list[0] : null;
		if (firstSong?.url_id) {
			const meting2 = new Meting(server);
			const cookies = PLATFORM_COOKIES[server] || "";
			if (cookies) meting2.cookie(cookies);
			const urlResult = await meting2.url(firstSong.url_id);
			urlTest = typeof urlResult === "string" ? JSON.parse(urlResult) : urlResult;
		}

		res.json({
			params: { server, type, id },
			cookieLength: (PLATFORM_COOKIES[server] || "").length,
			songCount: Array.isArray(list) ? list.length : 0,
			firstSong,
			urlTest,
		});
	} catch (e) {
		if (!res.headersSent) res.status(500).json({ error: e.message });
	}
});

app.listen(PORT, () => {
	console.log(`Firefly Meting API 运行在端口 ${PORT}`);
	const platforms = Object.entries(PLATFORM_COOKIES)
		.filter(([, v]) => v)
		.map(([k]) => k);
	console.log(`已配置 cookie 的平台: ${platforms.length ? platforms.join(", ") : "无"}`);
});
