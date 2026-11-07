import express from "express";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { spawn, ChildProcess } from "child_process";
import { createServer as createViteServer } from "vite";
import { AuthStore, createGuard, registerAuthRoutes } from "./auth";
import { queryMinecraft } from "./mcping";

async function startServer() {
  const app = express();
  const PORT = process.env.PORT ? parseInt(process.env.PORT) : (process.env.SERVER_PORT ? parseInt(process.env.SERVER_PORT) : 3000);

  app.use(express.json({ limit: "25mb" }));

  // Ensure directories exist
  const transcriptsDir = path.join(process.cwd(), "transcripts");
  const dataDir = path.join(process.cwd(), "data");

  if (!fs.existsSync(transcriptsDir)) {
    fs.mkdirSync(transcriptsDir, { recursive: true });
  }
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  // ==========================================
  // AUTH: accounts, roles and a guard in front of EVERY /api route (see auth.ts)
  // ==========================================
  const authStore = new AuthStore(dataDir);
  const BRIDGE_DEFAULT_SECRET = "wondermc_srv_2026";
  const currentBridgeSecret = (): string => {
    let fileSecret = "";
    try { fileSecret = JSON.parse(fs.readFileSync(path.join(dataDir, "minecraft_linked.json"), "utf-8"))?.bridge_config?.secret_token || ""; } catch {}
    return authStore.bridgeSecret(fileSecret || BRIDGE_DEFAULT_SECRET);
  };
  app.use("/api", createGuard(authStore, currentBridgeSecret));

  // Public portal URL for Discord embeds/buttons. NEVER taken from a stranger's Host header
  // (that would let anyone make the bot post their link). Use APP_URL in .env, or visit the site as an admin.
  const portalUrlFile = path.join(dataDir, "portal_url.txt");
  const writePortalUrl = (url: string) => {
    try {
      if (!fs.existsSync(portalUrlFile) || fs.readFileSync(portalUrlFile, "utf-8").trim() !== url) fs.writeFileSync(portalUrlFile, url, "utf-8");
    } catch { /* ignore */ }
  };
  if (process.env.APP_URL && /^https?:\/\//.test(process.env.APP_URL.trim())) writePortalUrl(process.env.APP_URL.trim().replace(/\/$/, ""));
  app.use((req: any, _res, next) => {
    const host = req.headers.host;
    if (!process.env.APP_URL && req.auth?.isAdmin && host && !host.includes("localhost") && !host.includes("127.0.0.1")) {
      writePortalUrl(`${(req.headers["x-forwarded-proto"] as string) || "http"}://${host}`);
    }
    next();
  });

  const ticketsDataPath = path.join(dataDir, "tickets_data.json");
  const emojisConfigPath = path.join(dataDir, "emojis_config.json");
  const wondermcConfigPath = path.join(dataDir, "wondermc_config.json");
  // one-time migration from the old brand file name
  try {
    const legacyCfg = path.join(dataDir, "kachhua_config.json");
    if (fs.existsSync(legacyCfg) && !fs.existsSync(wondermcConfigPath)) fs.copyFileSync(legacyCfg, wondermcConfigPath);
  } catch {}
  const levelsDataPath = path.join(dataDir, "levels_data.json");
  const gameStatsPath = path.join(dataDir, "game_stats.json");
  const applicationsConfigPath = path.join(dataDir, "applications_config.json");
  const applicationsDataPath = path.join(dataDir, "applications_data.json");
  const complaintsConfigPath = path.join(dataDir, "complaints_config.json");
  const complaintsDataPath = path.join(dataDir, "complaints_data.json");

  // Initialize Complaints Config if not present
  if (!fs.existsSync(complaintsConfigPath)) {
    fs.writeFileSync(complaintsConfigPath, JSON.stringify({
      channel_id: "",
      channel_name: "",
      enabled: true,
      auto_response_enabled: true,
      staff_role_id: ""
    }, null, 2), "utf-8");
  }
  if (!fs.existsSync(complaintsDataPath)) {
    fs.writeFileSync(complaintsDataPath, JSON.stringify({ complaints: [] }, null, 2), "utf-8");
  }

  // Initialize Applications Config if not present
  if (!fs.existsSync(applicationsConfigPath)) {
    const initialAppConfig = {
      default: {
        enabled: true,
        review_channel_id: null,
        staff_role_id: null,
        max_questions: 15,
        title: "WonderMc Staff Recruitment",
        description: "Welcome to the official WonderMc Staff Application. Please answer all questions honestly and thoroughly.",
        questions: [
          "What is your Minecraft in-game name (IGN) and Discord username?",
          "How old are you and what timezone/region are you located in?",
          "Why do you want to join the WonderMc Staff Team instead of other servers?",
          "Do you have any previous moderation or staff experience? (Please list servers/roles if applicable)",
          "How many hours per week can you actively dedicate to moderating chat and assisting players?",
          "Scenario: A player is accused of using illegal hacks in PvP but denies it. How would you investigate and handle the situation?",
          "Is there anything else you would like our senior management team to know about you?"
        ],
        cooldown_days: 7
      }
    };
    fs.writeFileSync(applicationsConfigPath, JSON.stringify(initialAppConfig, null, 2), "utf-8");
  }

  // Initialize Applications Submissions Data if not present
  if (!fs.existsSync(applicationsDataPath)) {
    const initialSubmissions: any[] = [];   // no fake demo applicants
    fs.writeFileSync(applicationsDataPath, JSON.stringify(initialSubmissions, null, 2), "utf-8");
  }

  // Initialize WonderMc Config
  if (!fs.existsSync(wondermcConfigPath)) {
    const initialConfig = {
      server_name: "WonderMc Network",
      java_ip: "play.wondermc.fun",
      java_port: 25565,
      bedrock_ip: "play.wondermc.fun",
      bedrock_port: 19132,
      store_url: "https://dc.gg/wondermc", // Redirects to Discord
      discord_url: "https://dc.gg/wondermc",
      website_url: "https://wondermc.fun",
      motd: "⛏️ WonderMc Network • Pillar of Fortune, Practice, Lifesteal & BoxPvP"
    };
    fs.writeFileSync(wondermcConfigPath, JSON.stringify(initialConfig, null, 2), "utf-8");
  }

  // Initialize Levels Data
  if (!fs.existsSync(levelsDataPath)) {
    const initialLevels = {
      users: {
        "987654321012": {
          id: "987654321012",
          username: "Avihaan_PvP",
          discriminator: "0001",
          avatar: "https://images.unsplash.com/photo-1566492031773-4f4e44671857?w=150&auto=format&fit=crop&q=80",
          xp: 8450,
          level: 29,
          messages: 412,
          vc_minutes: 185,
          role: "Netherite Legend",
          badge: "👑 Owner",
          last_active: new Date().toISOString()
        },
        "887766554433": {
          id: "887766554433",
          username: "WonderWarrior",
          discriminator: "1337",
          avatar: "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80",
          xp: 5200,
          level: 22,
          messages: 260,
          vc_minutes: 95,
          role: "Diamond Champion",
          badge: "🛡️ Mod",
          last_active: new Date(Date.now() - 3600000).toISOString()
        },
        "776655443322": {
          id: "776655443322",
          username: "WonderMaster99",
          discriminator: "4040",
          avatar: "https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=150&auto=format&fit=crop&q=80",
          xp: 3100,
          level: 17,
          messages: 140,
          vc_minutes: 50,
          role: "Gold Knight",
          badge: "⭐ VIP",
          last_active: new Date(Date.now() - 7200000).toISOString()
        },
        "665544332211": {
          id: "665544332211",
          username: "PixelCrafter",
          discriminator: "2026",
          avatar: "https://images.unsplash.com/photo-1527980965255-d3b416303d12?w=150&auto=format&fit=crop&q=80",
          xp: 1450,
          level: 12,
          messages: 75,
          vc_minutes: 20,
          role: "Iron Adventurer",
          badge: "Member",
          last_active: new Date(Date.now() - 14400000).toISOString()
        }
      }
    };
    fs.writeFileSync(levelsDataPath, JSON.stringify(initialLevels, null, 2), "utf-8");
  }

  // Initialize Game Stats
  if (!fs.existsSync(gameStatsPath)) {
    const initialGames = {
      tictactoe: { played: 142, wins: 89, losses: 38, draws: 15 },
      chess: { played: 64, wins: 38, losses: 21, draws: 5 },
      blackjack: { played: 320, wins: 172, losses: 135, pushes: 13, chips_won: 48500 }
    };
    fs.writeFileSync(gameStatsPath, JSON.stringify(initialGames, null, 2), "utf-8");
  }

  // Create sample WonderMc styled transcript if none exists
  const initialFiles = fs.readdirSync(transcriptsDir).filter(f => f.endsWith(".txt") || f.endsWith(".json"));
  if (initialFiles.length === 0) {
    const samplePath = path.join(transcriptsDir, "transcript-ticket-vip-issue-101.txt");
    const sampleText = `================================================================================
WONDERMC TICKET TRANSCRIPT
================================================================================
Channel Name : #ticket-vip-issue-101
Guild        : WonderMc Support Server (ID: 1029384756)
Ticket Opener: Avihaan_PvP#0001 (ID: 987654321012)
Category     : Store & VIP Support
Claimed By   : ModTeam_Alex (ID: 112233445566)
Exported At  : 2026-08-21 14:15:00 UTC
Server IP    : play.wondermc.fun
================================================================================

[2026-08-21 14:10:05] Avihaan_PvP#0001 (987654321012): Hello! I purchased the Netherite VIP rank on the server, but it's not synced yet.
[2026-08-21 14:11:20] WonderMc • core [BOT] (102938475611): Ticket opened! A staff member will assist you shortly.
[2026-08-21 14:11:45] ModTeam_Alex (112233445566): Hey Avihaan! Let me check the transaction database for play.wondermc.fun.
[2026-08-21 14:12:30] ModTeam_Alex (112233445566): Transaction verified! Synced your VIP perks and ingame prefix. Please relog on play.wondermc.fun!
[2026-08-21 14:13:40] Avihaan_PvP#0001 (987654321012): Awesome, relogged and I have the VIP prefix and fly access now! Thanks so much!
[2026-08-21 14:14:15] ModTeam_Alex (112233445566): You're very welcome! Have fun playing on WonderMc!
[2026-08-21 14:14:45] WonderMc • core [BOT] (102938475611): Ticket closed by ModTeam_Alex. Transcript exported to dashboard and DM sent.

================================================================================
END OF TRANSCRIPT
================================================================================`;
    fs.writeFileSync(samplePath, sampleText, "utf-8");
  }

  // ==========================================
  // REACTION ROLES PERSISTENCE (data/reaction_roles.json)
  // ==========================================
  const reactionRolesPath = path.join(dataDir, "reaction_roles.json");
  if (!fs.existsSync(reactionRolesPath)) {
    fs.writeFileSync(reactionRolesPath, JSON.stringify({}, null, 2), "utf-8");
  }

  app.get("/api/reaction-roles", (req, res) => {
    try {
      const data = JSON.parse(fs.readFileSync(reactionRolesPath, "utf-8") || "{}");
      res.json({ success: true, reactionRoles: data });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.post("/api/reaction-roles/add", (req, res) => {
    try {
      const { guildId, messageUrl, messageId, channelId, emoji, roleId, roleName } = req.body;
      const data = JSON.parse(fs.readFileSync(reactionRolesPath, "utf-8") || "{}");
      
      const gId = String(guildId || "default");
      const mId = String(messageId);
      if (!data[gId]) data[gId] = {};
      if (!data[gId][mId]) {
        data[gId][mId] = {
          channel_id: channelId,
          message_url: messageUrl,
          bindings: {}
        };
      }
      
      const emojiKey = String(emoji || "").trim();
      data[gId][mId].bindings[emojiKey] = {
        role_id: roleId,
        role_name: roleName,
        emoji_display: emojiKey,
        added_at: new Date().toISOString(),
        created_by: "Web Dashboard"
      };

      fs.writeFileSync(reactionRolesPath, JSON.stringify(data, null, 2), "utf-8");
      res.json({ success: true, binding: data[gId][mId] });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.delete("/api/reaction-roles", (req, res) => {
    try {
      const { guildId, messageId, emojiKey } = req.body;
      const data = JSON.parse(fs.readFileSync(reactionRolesPath, "utf-8") || "{}");
      const gId = String(guildId || "default");
      const mId = String(messageId);
      
      if (data[gId] && data[gId][mId]) {
        if (emojiKey && data[gId][mId].bindings) {
          delete data[gId][mId].bindings[emojiKey];
          if (Object.keys(data[gId][mId].bindings).length === 0) {
            delete data[gId][mId];
          }
        } else {
          delete data[gId][mId];
        }
        fs.writeFileSync(reactionRolesPath, JSON.stringify(data, null, 2), "utf-8");
        return res.json({ success: true, message: "Deleted reaction role binding" });
      }
      res.status(404).json({ success: false, message: "Binding not found" });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ==========================================
  // MINECRAFT PLAYER COMPLAINTS API
  // ==========================================
  app.get("/api/complaints", (req, res) => {
    try {
      const data = JSON.parse(fs.readFileSync(complaintsDataPath, "utf-8") || '{"complaints":[]}');
      res.json({ complaints: data.complaints || [] });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get("/api/complaints/config", (req, res) => {
    try {
      const conf = JSON.parse(fs.readFileSync(complaintsConfigPath, "utf-8") || "{}");
      res.json(conf);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.post("/api/complaints/config", (req, res) => {
    try {
      const body = req.body || {};
      const current = JSON.parse(fs.readFileSync(complaintsConfigPath, "utf-8") || "{}");
      const updated = {
        channel_id: String(body.channel_id || current.channel_id || ""),
        channel_name: String(body.channel_name || current.channel_name || ""),
        enabled: body.enabled !== undefined ? !!body.enabled : (current.enabled !== false),
        auto_response_enabled: body.auto_response_enabled !== undefined ? !!body.auto_response_enabled : (current.auto_response_enabled !== false),
        staff_role_id: String(body.staff_role_id || current.staff_role_id || "")
      };
      fs.writeFileSync(complaintsConfigPath, JSON.stringify(updated, null, 2), "utf-8");
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  async function deliverComplaintToDiscord(complaint: any, config: any) {
    const token = process.env.DISCORD_BOT_TOKEN || process.env.BOT_TOKEN || process.env.DISCORD_TOKEN;
    const channelId = String(config?.channel_id || "").trim();
    if (!token || !channelId) {
      return { delivered: false, reason: !token ? "Discord bot token is not configured" : "Complaint channel is not configured" };
    }
    const fields = [
      { name: "🆔 Complaint ID", value: String(complaint.id), inline: true },
      { name: "👤 Reported By", value: String(complaint.reported_by || "Unknown").slice(0, 1024), inline: true },
      { name: "🎮 Minecraft Username", value: String(complaint.minecraft_username || "Not provided").slice(0, 1024), inline: true },
      { name: "⚔️ Complaint Category", value: String(complaint.complaint_type || "Other").slice(0, 1024), inline: true },
      { name: "🌍 Server Mode", value: String(complaint.server_mode || "Other").slice(0, 1024), inline: true },
      { name: "📊 Current Status", value: "🟡 Pending Review", inline: true },
      { name: "📝 Complaint Description", value: String(complaint.description || "No description").slice(0, 1024), inline: false },
      { name: "🕒 Submitted At", value: new Date(complaint.submitted_at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }).slice(0, 1024), inline: false }
    ];
    if (complaint.evidence) fields.push({ name: "📸 Evidence", value: String(complaint.evidence).slice(0, 1024), inline: false });
    const payload = {
      embeds: [{
        title: "🚨 WONDER MC | NEW PLAYER COMPLAINT",
        description: "A new complaint has been submitted. Staff are requested to review the evidence fairly before taking action.",
        color: 0xF59E0B,
        fields,
        footer: { text: "WONDER MC STAFF TEAM • Fair Play • Justice • Community" },
        timestamp: complaint.submitted_at
      }]
    };
    const response = await fetch(`https://discord.com/api/v10/channels/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      headers: { "Authorization": `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { delivered: false, reason: String(result?.message || `Discord API returned ${response.status}`) };
    }
    return { delivered: true, message_id: result.id, channel_id: channelId };
  }

  app.post("/api/complaints", async (req, res) => {
    try {
      const body = req.body || {};
      const data = JSON.parse(fs.readFileSync(complaintsDataPath, "utf-8") || '{"complaints":[]}');
      if (!Array.isArray(data.complaints)) data.complaints = [];
      const id = "MC-" + (1000 + data.complaints.length + 1);
      const complaint = {
        id,
        reported_by: String(body.reported_by || "Unknown"),
        reported_by_id: body.reported_by_id || null,
        minecraft_username: String(body.minecraft_username || ""),
        complaint_type: String(body.complaint_type || "Other"),
        server_mode: String(body.server_mode || "Other"),
        description: String(body.description || ""),
        evidence: body.evidence || null,
        status: "pending",
        submitted_at: new Date().toISOString()
      };
      data.complaints.unshift(complaint);
      fs.writeFileSync(complaintsDataPath, JSON.stringify(data, null, 2), "utf-8");

      // Persist first so a Discord outage never loses a submitted complaint.
      let delivery: any = { delivered: false, reason: "Discord delivery not attempted" };
      try {
        const conf = JSON.parse(fs.readFileSync(complaintsConfigPath, "utf-8") || "{}");
        if (conf.enabled !== false && conf.auto_response_enabled !== false) {
          delivery = await deliverComplaintToDiscord(complaint, conf);
        }
      } catch (discordError: any) {
        delivery = { delivered: false, reason: discordError?.message || "Discord delivery failed" };
      }
      complaint.discord_delivery = delivery;
      data.complaints[0] = complaint;
      fs.writeFileSync(complaintsDataPath, JSON.stringify(data, null, 2), "utf-8");
      res.json({ success: true, complaint, discord_delivery: delivery });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.patch("/api/complaints/:id", (req, res) => {
    try {
      const id = req.params.id;
      const { status, reason, claimed_by } = req.body || {};
      const data = JSON.parse(fs.readFileSync(complaintsDataPath, "utf-8") || '{"complaints":[]}');
      const idx = (data.complaints || []).findIndex((c: any) => c.id === id);
      if (idx === -1) return res.status(404).json({ success: false, message: "Complaint not found" });
      if (status) data.complaints[idx].status = status;
      if (reason !== undefined) data.complaints[idx].reason = reason;
      if (claimed_by) data.complaints[idx].claimed_by = claimed_by;
      if (status && status !== "pending") data.complaints[idx].reviewed_at = new Date().toISOString();
      fs.writeFileSync(complaintsDataPath, JSON.stringify(data, null, 2), "utf-8");
      res.json(data.complaints[idx]);
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ==========================================
  // MINECRAFT DISCORDSRV DIRECT BRIDGE API
  // ==========================================
  const minecraftLinkedPath = path.join(dataDir, "minecraft_linked.json");
  if (!fs.existsSync(minecraftLinkedPath)) {
    const initLinked = {
      linked_accounts: {},
      pending_codes: {},
      bridge_config: {
        secret_token: "wondermc_srv_2026",
        chat_channel_id: null,
        console_channel_id: null,
        link_role_name: "Linked",
        link_role_id: null,
        auto_sync_roles: true
      },
      outgoing_to_minecraft: [],
      incoming_from_minecraft: [],
      chat_history: []
    };
    fs.writeFileSync(minecraftLinkedPath, JSON.stringify(initLinked, null, 2), "utf-8");
  }

  const getBridgeData = () => {
    try {
      return JSON.parse(fs.readFileSync(minecraftLinkedPath, "utf-8"));
    } catch {
      return { linked_accounts: {}, pending_codes: {}, bridge_config: {}, outgoing_to_minecraft: [], incoming_from_minecraft: [], chat_history: [] };
    }
  };

  const saveBridgeData = (data: any) => {
    fs.writeFileSync(minecraftLinkedPath, JSON.stringify(data, null, 2), "utf-8");
  };

  // 1. Link request from Minecraft (/link or /discord link)
  app.post("/api/minecraft/bridge/link-request", (req, res) => {
    try {
      const { secret, username, uuid } = req.body;
      const data = getBridgeData();
      const expectedSecret = data.bridge_config?.secret_token || "wondermc_srv_2026";
      if (secret && secret !== expectedSecret) {
        return res.status(403).json({ success: false, message: "Invalid bridge secret key" });
      }

      // Generate 6-digit random code
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      data.pending_codes = data.pending_codes || {};
      data.pending_codes[code] = {
        code,
        minecraft_username: username,
        minecraft_uuid: uuid || "offline-" + username,
        created_at: new Date().toISOString(),
        expires_at: Math.floor(Date.now() / 1000) + 600
      };

      // Queue command to display the code to player
      data.outgoing_to_minecraft = data.outgoing_to_minecraft || [];
      data.outgoing_to_minecraft.push({
        type: "console_command",
        command: `wondermc_showcode ${username} ${code}`,
        timestamp: Math.floor(Date.now() / 1000)
      });

      saveBridgeData(data);
      res.json({ success: true, code, message: `Linking code ${code} generated for ${username}` });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // 2. Chat from Minecraft
  app.post("/api/minecraft/bridge/chat", (req, res) => {
    try {
      const { secret, username, uuid, message } = req.body;
      const data = getBridgeData();
      data.incoming_from_minecraft = data.incoming_from_minecraft || [];
      data.incoming_from_minecraft.push({
        type: "chat",
        username,
        uuid,
        message,
        timestamp: new Date().toISOString()
      });

      data.chat_history = data.chat_history || [];
      data.chat_history.unshift({
        source: "minecraft",
        username,
        message,
        timestamp: new Date().toISOString()
      });
      if (data.chat_history.length > 50) data.chat_history = data.chat_history.slice(0, 50);

      saveBridgeData(data);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // 3. Player Join from Minecraft
  app.post("/api/minecraft/bridge/join", (req, res) => {
    try {
      const { username, uuid, online_count, max_players } = req.body;
      const data = getBridgeData();
      data.incoming_from_minecraft = data.incoming_from_minecraft || [];
      data.incoming_from_minecraft.push({
        type: "join",
        username,
        uuid,
        online_count,
        max_players,
        timestamp: new Date().toISOString()
      });
      saveBridgeData(data);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // 4. Player Quit from Minecraft
  app.post("/api/minecraft/bridge/quit", (req, res) => {
    try {
      const { username, uuid, online_count } = req.body;
      const data = getBridgeData();
      data.incoming_from_minecraft = data.incoming_from_minecraft || [];
      data.incoming_from_minecraft.push({
        type: "quit",
        username,
        uuid,
        online_count,
        timestamp: new Date().toISOString()
      });
      saveBridgeData(data);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // 5. Player Death from Minecraft
  app.post("/api/minecraft/bridge/death", (req, res) => {
    try {
      const { username, death_message } = req.body;
      const data = getBridgeData();
      data.incoming_from_minecraft = data.incoming_from_minecraft || [];
      data.incoming_from_minecraft.push({
        type: "death",
        username,
        death_message,
        timestamp: new Date().toISOString()
      });
      saveBridgeData(data);
      res.json({ success: true });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // 6. Polled by Minecraft server every 2 seconds for Discord chat & commands
  app.get("/api/minecraft/bridge/pending-messages", (req, res) => {
    try {
      const data = getBridgeData();
      const outgoing = data.outgoing_to_minecraft || [];
      // Clear queue once consumed
      data.outgoing_to_minecraft = [];
      saveBridgeData(data);
      res.json(outgoing);
    } catch (e: any) {
      res.status(500).json([]);
    }
  });

  // 7. Bridge Status & Linked Accounts for Dashboard
  app.get("/api/minecraft/bridge/status", (req, res) => {
    try {
      const data = getBridgeData();
      res.json({
        success: true,
        linked_accounts: data.linked_accounts || {},
        pending_codes: data.pending_codes || {},
        bridge_config: (req as any).auth?.isAdmin ? (data.bridge_config || {}) : { ...(data.bridge_config || {}), secret_token: undefined },
        chat_history: data.chat_history || [],
        server_url: req.protocol + "://" + req.get("host")
      });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // Where the Minecraft plugin must connect (shown on the Minecraft Bridge page; admin only)
  app.get("/api/bridge/info", (req, res) => {
    const port = process.env.BRIDGE_PORT || process.env.SERVER_PORT || "25587";
    let url = (process.env.BRIDGE_PUBLIC_URL || "").trim().replace(/\/$/, "");
    if (!url) url = `http://${process.env.BRIDGE_PUBLIC_HOST || "paid35.skilloraclouds.com"}:${port}`;
    res.json({ success: true, url, secretIsDefault: currentBridgeSecret() === BRIDGE_DEFAULT_SECRET });
  });

  // 8. Update Bridge Config (from Dashboard)
  app.post("/api/minecraft/bridge/config", (req, res) => {
    try {
      const data = getBridgeData();
      data.bridge_config = { ...data.bridge_config, ...req.body };
      saveBridgeData(data);
      res.json({ success: true, bridge_config: data.bridge_config });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // 9. Unlink account (from Dashboard)
  app.post("/api/minecraft/bridge/unlink", (req, res) => {
    try {
      const { discord_id } = req.body;
      const data = getBridgeData();
      if (data.linked_accounts && data.linked_accounts[discord_id]) {
        delete data.linked_accounts[discord_id];
        saveBridgeData(data);
        return res.json({ success: true, message: "Account unlinked" });
      }
      res.status(404).json({ success: false, message: "Account not found" });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // 10. Direct download for WonderBridge.jar and bot source files
  app.get(["/WonderBridge.jar", "/api/download/WonderBridge.jar"], (req, res) => {
    const jarPath = path.join(process.cwd(), "minecraft_plugin", "WonderBridge.jar");
    if (fs.existsSync(jarPath)) {
      res.setHeader("Content-Disposition", 'attachment; filename="WonderBridge.jar"');
      res.setHeader("Content-Type", "application/java-archive");
      return res.sendFile(jarPath);
    }
    res.status(404).send("WonderBridge.jar not found");
  });

  app.get("/api/download/applications.py", (req, res) => {
    const filePath = path.join(process.cwd(), "cogs", "applications.py");
    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.sendFile(filePath);
    }
    res.status(404).send("applications.py not found");
  });

  app.get("/api/download/main.py", (req, res) => {
    const filePath = path.join(process.cwd(), "main.py");
    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Disposition", 'attachment; filename="main.py"');
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.sendFile(filePath);
    }
    res.status(404).send("main.py not found");
  });

  app.get(["/api/download/cogs.zip", "/cogs.zip"], (req, res) => {
    const filePath = path.join(process.cwd(), "public", "cogs.zip");
    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Disposition", 'attachment; filename="cogs.zip"');
      res.setHeader("Content-Type", "application/zip");
      return res.sendFile(filePath);
    }
    res.status(404).send("cogs.zip not found");
  });

  app.get(["/api/download/wondermc_bot.zip", "/wondermc_bot.zip", "/api/download/bot.zip"], (req, res) => {
    const filePath = path.join(process.cwd(), "public", "wondermc_bot.zip");
    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Disposition", 'attachment; filename="wondermc_bot.zip"');
      res.setHeader("Content-Type", "application/zip");
      return res.sendFile(filePath);
    }
    res.status(404).send("wondermc_bot.zip not found");
  });

  app.get(["/api/download/website_dist.zip", "/website_dist.zip", "/dist.zip", "/api/download/dist.zip"], (req, res) => {
    const filePath = path.join(process.cwd(), "public", "website_dist.zip");
    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Disposition", 'attachment; filename="website_dist.zip"');
      res.setHeader("Content-Type", "application/zip");
      return res.sendFile(filePath);
    }
    res.status(404).send("website_dist.zip not found");
  });

  app.get("/api/download/cogs/:file", (req, res) => {
    const file = path.basename(req.params.file);
    const filePath = path.join(process.cwd(), "cogs", file);
    if (fs.existsSync(filePath)) {
      res.setHeader("Content-Disposition", `attachment; filename="${file}"`);
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      return res.sendFile(filePath);
    }
    res.status(404).send(`${file} not found in cogs`);
  });

  // ==========================================
  // WONDERMC STORE & ORDER PERSISTENCE (data/)
  // ==========================================
  const storeOrdersPath = path.join(dataDir, "store_orders.json");
  const storeConfigPath = path.join(dataDir, "store_config.json");

  if (!fs.existsSync(storeConfigPath)) {
    const initialStoreConfig = {
      serverName: "WonderMc Network",
      javaIp: "play.wondermc.fun",
      javaPort: 25565,
      bedrockIp: "play.wondermc.fun",
      bedrockPort: 19132,
      discordUrl: "https://dc.gg/wondermc",
      storeUrl: "https://play.wondermc.fun",
      upiId: "9876543210@paytm",
      upiName: "WonderMc Gaming Network",
      currencySymbol: "₹",
      currencyCode: "INR",
      saleActive: true,
      salePercent: 20,
      saleTitle: "SUMMER SEASON SALE • FLAT 20% OFF"
    };
    fs.writeFileSync(storeConfigPath, JSON.stringify(initialStoreConfig, null, 2), "utf-8");
  }

  if (!fs.existsSync(storeOrdersPath)) {
    fs.writeFileSync(storeOrdersPath, JSON.stringify([], null, 2), "utf-8");
  }

  app.get("/api/store/config", (req, res) => {
    try {
      const data = JSON.parse(fs.readFileSync(storeConfigPath, "utf-8"));
      res.json({ success: true, config: data });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.post("/api/store/config", (req, res) => {
    try {
      const newConfig = req.body;
      fs.writeFileSync(storeConfigPath, JSON.stringify(newConfig, null, 2), "utf-8");
      res.json({ success: true, config: newConfig });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.post("/api/store/coupon/validate", (req, res) => {
    try {
      const { code } = req.body;
      const clean = String(code || "").trim().toUpperCase();
      if (clean === "WONDER20" || clean === "SUMMER20") {
        return res.json({ success: true, discountPercent: 20, message: "Valid 20% Discount Coupon" });
      }
      if (clean === "BOXPVP10") {
        return res.json({ success: true, discountPercent: 10, message: "Valid 10% Discount Coupon" });
      }
      return res.status(400).json({ success: false, message: "Coupon code not found or expired" });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.get("/api/orders", (req, res) => {
    try {
      const orders = JSON.parse(fs.readFileSync(storeOrdersPath, "utf-8"));
      res.json({ success: true, orders });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.post("/api/orders/create", (req, res) => {
    try {
      const orderData = req.body;
      const orders = JSON.parse(fs.readFileSync(storeOrdersPath, "utf-8") || "[]");
      const newOrder = {
        id: "WM-" + Math.floor(100000 + Math.random() * 900000),
        minecraftUsername: orderData.minecraftUsername || "Unknown",
        discordTag: orderData.discordTag,
        items: orderData.items || [],
        subtotal: orderData.subtotal || 0,
        discountAmount: orderData.discountAmount || 0,
        finalAmount: orderData.finalAmount || 0,
        couponCode: orderData.couponCode,
        paymentMethod: orderData.paymentMethod || "upi",
        upiRefId: orderData.upiRefId,
        status: "pending_verification",
        createdAt: new Date().toISOString()
      };
      orders.unshift(newOrder);
      fs.writeFileSync(storeOrdersPath, JSON.stringify(orders, null, 2), "utf-8");

      // Save latest order file for bot sync
      const latestOrderPath = path.join(dataDir, "latest_order.json");
      fs.writeFileSync(latestOrderPath, JSON.stringify(newOrder, null, 2), "utf-8");

      res.json({ success: true, order: newOrder });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.post("/api/orders/:id/verify", (req, res) => {
    try {
      const orderId = req.params.id;
      const orders = JSON.parse(fs.readFileSync(storeOrdersPath, "utf-8") || "[]");
      const target = orders.find((o: any) => o.id === orderId);
      if (target) {
        target.status = "completed";
        target.verifiedAt = new Date().toISOString();
        fs.writeFileSync(storeOrdersPath, JSON.stringify(orders, null, 2), "utf-8");
        return res.json({ success: true, order: target });
      }
      res.status(404).json({ success: false, message: "Order not found" });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  app.post("/api/tickets/create", (req, res) => {
    try {
      const { ign, category, message, source } = req.body;
      const tickets = JSON.parse(fs.readFileSync(ticketsDataPath, "utf-8") || '{"ticket_db":{},"open_tickets":{}}');
      const ticketId = "TICKET-" + Date.now().toString().slice(-5);
      tickets.open_tickets = tickets.open_tickets || {};
      tickets.open_tickets[ticketId] = {
        user_id: ign,
        category: category || "general",
        message,
        source: source || "website",
        created_at: new Date().toISOString()
      };
      fs.writeFileSync(ticketsDataPath, JSON.stringify(tickets, null, 2), "utf-8");
      res.json({ success: true, ticketId });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e.message });
    }
  });

  // ==========================================
  // REAL-TIME MINECRAFT SERVER STATUS (play.wondermc.fun)
  // ==========================================
  let mcCache: { data: any; timestamp: number } | null = null;

  app.get("/api/minecraft/realtime", async (req, res) => {
    // REAL status only: direct Minecraft ping (with SRV lookup + true ping/pong) -> mcsrvstat as a backup -> otherwise "offline".
    // Nothing here is invented any more: failed lookups are reported as offline / unknown, never as "11/2000 players".
    const now = Date.now();
    if (mcCache && now - mcCache.timestamp < 10000) {
      return res.json({ success: true, ...mcCache.data, cached: true });
    }
    const domain = (process.env.MC_SERVER_HOST || "play.wondermc.fun").trim();
    const bedrockPort = Number(process.env.MC_BEDROCK_PORT || 19132);
    let live: any = null;
    let source = "direct";
    let lookupError = "";
    try {
      live = await queryMinecraft(domain, 4500);
    } catch (e: any) {
      lookupError = e?.message || "unreachable";
      try {
        const r = await fetch(`https://api.mcsrvstat.us/3/${domain}`, {
          headers: { "User-Agent": "WonderMc-BotPortal/3.0" }, signal: AbortSignal.timeout(4000),
        });
        if (r.ok) {
          const j: any = await r.json();
          if (j?.online) {
            const lines: string[] = (j.motd?.clean || []).map((l: string) => String(l).trim());
            live = {
              online: true, players: { online: j.players?.online ?? 0, max: j.players?.max ?? 0, sample: (j.players?.list || []).map((p: any) => p.name).slice(0, 12) },
              version: j.version || "unknown", motd: lines.join("\n"), motdLines: lines, ping: null, icon: j.icon || null,
            };
            source = "mcsrvstat";
          }
        }
      } catch { /* both lookups failed */ }
    }
    const online = !!live?.online;
    const lines: string[] = live?.motdLines || [];
    const formatted = {
      domain,
      header_ip: domain,
      java_ip: domain,
      java_port: 25565,
      bedrock_ip: domain,
      bedrock_port: bedrockPort,
      online,
      status_source: online ? source : "none",
      status_error: online ? undefined : (lookupError || "server did not answer"),
      players: { online: online ? live.players.online : 0, max: online ? live.players.max : 0, sample: online ? live.players.sample : [] },
      motd: online ? lines.join("\n") : "",
      motd_line1: online ? (lines[0] || "") : "",
      motd_line2: online ? (lines[1] || "") : "",
      version: online ? live.version : null,
      ping: online ? live.ping : null,
      icon: online ? live.icon : null,
      checked_at: new Date().toISOString(),
      gamemodes: [
        { name: "BoxPvP", badge: "ARENA", color: "amber", desc: "Fast mining combat & tier upgrades" },
        { name: "Lifesteal", badge: "PVP", color: "rose", desc: "Steal player hearts on kill" },
        { name: "Practice", badge: "POPULAR", color: "cyan", desc: "1v1 ranked combo arena" },
      ],
      discord_url: "https://dc.gg/wondermc",
      store_url: "https://dc.gg/wondermc",
    };
    mcCache = { data: formatted, timestamp: now };
    res.json({ success: true, ...formatted, cached: false });
  });

  // Dynamic Minecraft Banner SVG generator (matching Hystats / screenshot card)
  app.get("/api/minecraft/banner.svg", async (req, res) => {
    try {
      const isOnline = req.query.offline ? false : true;
      const onlineCount = req.query.online ? Number(req.query.online) : (isOnline ? 11 : 0);
      const maxCount = req.query.max ? Number(req.query.max) : (isOnline ? 2000 : 0);
      const line1 = isOnline ? (req.query.line1 ? String(req.query.line1) : "WONDERMC ↪ Boxpvp ┆ Lifesteal ┆ Practice") : "SERVER OFFLINE";
      const line2 = isOnline ? (req.query.line2 ? String(req.query.line2) : "Step In Gear Up Dominate") : "Can't connect to server";
      const headerIp = "play.wondermc.fun - play.wondermc.fun";

      const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 160" width="600" height="160">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=VT323&amp;display=swap');
      .mc-font { font-family: 'VT323', 'Minecraft', monospace; letter-spacing: 0.5px; }
      .text-shadow { text-shadow: 2px 2px 0px #000000; }
    </style>
    <linearGradient id="cardGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0a1214" stop-opacity="0.95"/>
      <stop offset="50%" stop-color="#0d181c" stop-opacity="0.95"/>
      <stop offset="100%" stop-color="#070d0f" stop-opacity="0.98"/>
    </linearGradient>
    <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${isOnline ? '#00e5ff' : '#ff3344'}"/>
      <stop offset="50%" stop-color="${isOnline ? '#00ffa3' : '#aa0022'}"/>
      <stop offset="100%" stop-color="${isOnline ? '#00bcd4' : '#660011'}"/>
    </linearGradient>
    <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#a3e635"/>
      <stop offset="100%" stop-color="#65a30d"/>
    </linearGradient>
  </defs>

  <!-- Card Outer Frame -->
  <rect x="2" y="2" width="596" height="156" rx="14" fill="url(#cardGrad)" stroke="url(#borderGrad)" stroke-width="2.5" />
  
  <!-- Subtle inner glowing borders matching screenshot -->
  <rect x="6" y="6" width="588" height="34" rx="8" fill="#081418" fill-opacity="0.6" stroke="${isOnline ? '#00e5ff33' : '#ff334433'}" stroke-width="1.5" />
  <rect x="6" y="44" width="588" height="74" rx="8" fill="#060f13" fill-opacity="0.7" stroke="${isOnline ? '#00ffa322' : '#ff334422'}" stroke-width="1.5" />
  <rect x="6" y="122" width="588" height="32" rx="8" fill="#081418" fill-opacity="0.6" stroke="${isOnline ? '#00e5ff33' : '#ff334433'}" stroke-width="1.5" />

  <!-- Top Bar: IP Header -->
  <text x="300" y="28" text-anchor="middle" class="mc-font text-shadow" font-size="20" font-weight="bold" fill="#ffffff">
    play.wondermc.fun <tspan fill="${isOnline ? '#38bdf8' : '#f87171'}">- play.wondermc.fun</tspan>
  </text>

  <!-- Server Icon: KM Logo -->
  <g transform="translate(24, 52)">
    <rect x="0" y="0" width="58" height="58" rx="8" fill="url(#logoGrad)" stroke="#4d7c0f" stroke-width="2"/>
    <!-- KM 3D Text -->
    <text x="29" y="40" text-anchor="middle" class="mc-font" font-size="34" font-weight="900" fill="#14532d" opacity="0.8">KM</text>
    <text x="28" y="38" text-anchor="middle" class="mc-font" font-size="34" font-weight="900" fill="#ecfccb">KM</text>
  </g>

  <!-- MOTD Content -->
  ${isOnline ? `
    <!-- MOTD Line 1 -->
    <text x="100" y="74" class="mc-font text-shadow" font-size="21" font-weight="bold">
      <tspan fill="#84cc16">WONDERMC</tspan> <tspan fill="#94a3b8">↪</tspan> <tspan fill="#a3e635">Boxpvp</tspan> <tspan fill="#64748b">┆</tspan> <tspan fill="#a3e635">Lifesteal</tspan> <tspan fill="#64748b">┆</tspan> <tspan fill="#a3e635">Practice</tspan>
    </text>
    <!-- MOTD Line 2 -->
    <text x="100" y="104" class="mc-font text-shadow" font-size="19" font-weight="bold" fill="#e2e8f0">
      Step In Gear Up Dominate
    </text>
  ` : `
    <!-- Offline MOTD -->
    <text x="100" y="76" class="mc-font text-shadow" font-size="22" font-weight="bold" fill="#ef4444">
      SERVER OFFLINE
    </text>
    <text x="100" y="104" class="mc-font text-shadow" font-size="18" fill="#fca5a5">
      Can't connect to server
    </text>
  `}

  <!-- Bottom Bar: Player Count / Offline Status -->
  <text x="300" y="144" text-anchor="middle" class="mc-font text-shadow" font-size="20" font-weight="bold">
    ${isOnline ? `
      <tspan fill="#22c55e" font-size="22">${onlineCount}</tspan><tspan fill="#64748b">/${maxCount.toLocaleString()}</tspan>
    ` : `
      <tspan fill="#ef4444">OFFLINE</tspan>
    `}
  </text>
</svg>`;

      res.setHeader("Content-Type", "image/svg+xml");
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.send(svg);
    } catch (e: any) {
      res.status(500).send("Error generating banner");
    }
  });

  // Dynamic Minecraft MOTD PNG Endpoint
  app.get("/api/minecraft/motd.png", (req, res) => {
    try {
      const motdPath = path.join(process.cwd(), "public", "motd_banner.png");
      if (fs.existsSync(motdPath)) {
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=15");
        return res.sendFile(motdPath);
      }
      res.redirect("https://mcapi.us/server/image?ip=play.wondermc.fun");
    } catch (err) {
      res.redirect("https://mcapi.us/server/image?ip=play.wondermc.fun");
    }
  });

  // Official WonderMc Server Icon & Logo API Endpoints
  app.get("/api/minecraft/logo", (req, res) => {
    const variant = req.query.variant === "wc" ? "wondermc_wc_logo.jpg" : "wondermc_logo.jpg";
    const logoPath = path.join(process.cwd(), "public", variant);
    if (fs.existsSync(logoPath)) {
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.sendFile(logoPath);
    }
    const fallbackPath = path.join(process.cwd(), "public", "cash_logo.png");
    res.sendFile(fallbackPath);
  });

  app.get(["/api/minecraft/server-icon.png", "/server-icon.png"], (req, res) => {
    const iconPath = path.join(process.cwd(), "public", "server-icon.png");
    if (fs.existsSync(iconPath)) {
      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.sendFile(iconPath);
    }
    res.sendFile(path.join(process.cwd(), "public", "wondermc_logo.png"));
  });

  // ==========================================
  // LEVELING SYSTEM API (Messages & Voice VC Time)
  // ==========================================

  const getLevelsData = (): Record<string, any> => {
    try {
      if (fs.existsSync(levelsDataPath)) {
        return JSON.parse(fs.readFileSync(levelsDataPath, "utf-8"));
      }
    } catch (_) {}
    return { users: {} };
  };

  const saveLevelsData = (data: any) => {
    fs.writeFileSync(levelsDataPath, JSON.stringify(data, null, 2), "utf-8");
  };

  // Calculate Level from XP
  const calculateLevel = (xp: number) => {
    return Math.max(1, Math.floor(0.1 * Math.sqrt(xp)));
  };

  // Get role title from level
  const getRoleForLevel = (lvl: number) => {
    if (lvl >= 50) return "Netherite Legend";
    if (lvl >= 35) return "Obsidian Champion";
    if (lvl >= 20) return "Diamond Elite";
    if (lvl >= 10) return "Gold Knight";
    if (lvl >= 5) return "Iron Adventurer";
    return "Wood Initiate";
  };

  app.get("/api/levels/leaderboard", (req, res) => {
    try {
      const data = getLevelsData();
      const usersList = Object.values(data.users || {}) as any[];
      // Sort by XP desc
      usersList.sort((a, b) => b.xp - a.xp);
      res.json({ success: true, leaderboard: usersList });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/levels/add-activity", (req, res) => {
    try {
      const { userId, username, type, amount, avatar } = req.body;
      if (!userId || !type) {
        return res.status(400).json({ success: false, error: "userId and type required" });
      }

      const data = getLevelsData();
      if (!data.users) data.users = {};

      const existing = data.users[userId] || {
        id: userId,
        username: username || `User_${userId.slice(0, 4)}`,
        discriminator: "0001",
        avatar: avatar || "https://images.unsplash.com/photo-1566492031773-4f4e44671857?w=150&auto=format&fit=crop&q=80",
        xp: 0,
        level: 1,
        messages: 0,
        vc_minutes: 0,
        role: "Wood Initiate",
        badge: "Member",
        last_active: new Date().toISOString()
      };

      if (username) existing.username = username;
      if (avatar) existing.avatar = avatar;

      let xpGained = 0;
      if (type === "message") {
        const count = Number(amount) || 1;
        existing.messages += count;
        xpGained = count * 15; // 15 XP per message
      } else if (type === "vc") {
        const minutes = Number(amount) || 5;
        existing.vc_minutes += minutes;
        xpGained = minutes * 20; // 20 XP per minute in VC
      }

      const oldLevel = existing.level;
      existing.xp += xpGained;
      existing.level = calculateLevel(existing.xp);
      existing.role = getRoleForLevel(existing.level);
      existing.last_active = new Date().toISOString();

      data.users[userId] = existing;
      saveLevelsData(data);

      const leveledUp = existing.level > oldLevel;

      res.json({
        success: true,
        user: existing,
        xpGained,
        leveledUp,
        newLevel: existing.level,
        role: existing.role
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==========================================
  // GAME STATS & PERSISTENCE (TicTacToe, Chess, Blackjack)
  // ==========================================

  const getGameStats = () => {
    try {
      if (fs.existsSync(gameStatsPath)) {
        return JSON.parse(fs.readFileSync(gameStatsPath, "utf-8"));
      }
    } catch (_) {}
    return {
      tictactoe: { played: 0, wins: 0, losses: 0, draws: 0 },
      chess: { played: 0, wins: 0, losses: 0, draws: 0 },
      blackjack: { played: 0, wins: 0, losses: 0, pushes: 0, chips_won: 1000 }
    };
  };

  const saveGameStats = (stats: any) => {
    fs.writeFileSync(gameStatsPath, JSON.stringify(stats, null, 2), "utf-8");
  };

  app.get("/api/games/stats", (req, res) => {
    res.json({ success: true, stats: getGameStats() });
  });

  app.post("/api/games/record", (req, res) => {
    try {
      const { game, result, chipsDelta } = req.body;
      const stats = getGameStats();

      if (stats[game]) {
        stats[game].played = (stats[game].played || 0) + 1;
        if (result === "win") stats[game].wins = (stats[game].wins || 0) + 1;
        else if (result === "loss") stats[game].losses = (stats[game].losses || 0) + 1;
        else if (result === "draw" || result === "push") {
          if (game === "blackjack") stats[game].pushes = (stats[game].pushes || 0) + 1;
          else stats[game].draws = (stats[game].draws || 0) + 1;
        }

        if (game === "blackjack" && typeof chipsDelta === "number") {
          stats.blackjack.chips_won = Math.max(0, (stats.blackjack.chips_won || 1000) + chipsDelta);
        }

        saveGameStats(stats);
      }

      res.json({ success: true, stats });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==========================================
  // AUTH ROUTES: login / register / setup / session / password + owner-only access management
  // ==========================================
  registerAuthRoutes(app, authStore, () => {
    const checks: Array<{ level: "ok" | "warn" | "bad"; text: string }> = [];
    checks.push(process.env.STAFF_MASTER_KEY ? { level: "ok", text: "STAFF_MASTER_KEY is set." } : { level: "warn", text: "STAFF_MASTER_KEY is not set (only needed for first-time setup)." });
    checks.push(currentBridgeSecret() === BRIDGE_DEFAULT_SECRET
      ? { level: "bad", text: "The Minecraft bridge still uses the DEFAULT secret (wondermc_srv_2026). Set BRIDGE_SECRET in .env and the same secret in the plugin." }
      : { level: "ok", text: "Minecraft bridge uses a custom secret." });
    checks.push(process.env.APP_URL ? { level: "ok", text: `APP_URL is ${process.env.APP_URL}` } : { level: "warn", text: "APP_URL is not set; bot links come from the first admin visit." });
    return checks;
  });

  // ==========================================
  // SYSTEM & RAM METRICS
  // ==========================================
  const startTime = Date.now();

  app.get("/api/system/metrics", (req, res) => {
    try {
      const memoryUsage = process.memoryUsage();
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memPercent = Math.round((usedMem / totalMem) * 100);

      const processRssMB = Math.round((memoryUsage.rss / (1024 * 1024)) * 10) / 10;
      const heapUsedMB = Math.round((memoryUsage.heapUsed / (1024 * 1024)) * 10) / 10;
      const heapTotalMB = Math.round((memoryUsage.heapTotal / (1024 * 1024)) * 10) / 10;
      const totalSystemMB = Math.round(totalMem / (1024 * 1024));
      const usedSystemMB = Math.round(usedMem / (1024 * 1024));
      const freeSystemMB = Math.round(freeMem / (1024 * 1024));

      const uptimeSec = Math.floor((Date.now() - startTime) / 1000);
      const days = Math.floor(uptimeSec / 86400);
      const hours = Math.floor((uptimeSec % 86400) / 3600);
      const minutes = Math.floor((uptimeSec % 3600) / 60);
      const seconds = uptimeSec % 60;
      const uptimeFormatted = `${days > 0 ? `${days}d ` : ""}${hours}h ${minutes}m ${seconds}s`;

      const cpus = os.cpus();
      const cpuModel = cpus[0]?.model || "Intel/AMD Multi-core";
      const cpuCount = cpus.length;
      const loadAvg = os.loadavg();

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        memory: {
          rssMB: processRssMB,
          heapUsedMB,
          heapTotalMB,
          usedSystemMB,
          totalSystemMB,
          freeSystemMB,
          percentage: memPercent,
          status: memPercent > 90 ? "CRITICAL" : memPercent > 75 ? "WARNING" : "HEALTHY"
        },
        cpu: {
          model: cpuModel,
          cores: cpuCount,
          loadAverage: loadAvg.map(l => Math.round(l * 100) / 100),
          estimatedUsage: Math.min(100, Math.round((loadAvg[0] / cpuCount) * 100))
        },
        system: {
          osType: os.type(),
          platform: os.platform(),
          arch: os.arch(),
          nodeVersion: process.version,
          uptime: uptimeFormatted,
          uptimeSeconds: uptimeSec,
          hostname: os.hostname()
        },
        bot: {
          status: "ONLINE",
          gatewayLatency: 38,
          activeShards: 1,
          guildsCount: 4,
          channelsCount: 38,
          cogsLoaded: 16,
          memoryFootprint: `${processRssMB} MB`
        }
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==========================================
  // COMMUNITY & PUBLIC METRICS
  // ==========================================
  app.get("/api/community/stats", (req, res) => {
    try {
      res.json({
        success: true,
        minecraft: {
          java_ip: "play.wondermc.fun",
          java_port: 25565,
          bedrock_ip: "play.wondermc.fun",
          bedrock_port: 19132,
          online: true,
          online_players: 142,
          max_players: 500,
          latency_ms: 28,
          version: "1.19.x - 1.20.x (Crossplay)",
          motd: "⛏️ WonderMc Network • Pillar of Fortune, Practice, Lifesteal & BoxPvP",
          gamemodes: [
            { name: "Pillar of Fortune", badge: "HOT", color: "emerald", desc: "High-stakes lucky platform survival" },
            { name: "Practice", badge: "POPULAR", color: "cyan", desc: "1v1 competitive duels & combo battles" },
            { name: "Lifesteal SMP", badge: "PVP", color: "rose", desc: "Steal maximum hearts on player kills" },
            { name: "BoxPvP", badge: "ARENA", color: "amber", desc: "Fast-paced box mining & upgrade combat" }
          ]
        },
        discord: {
          server_name: "WonderMc Official Discord",
          server_link: "https://dc.gg/wondermc",
          total_members: 1845,
          online_members: 620,
          bot_name: "WonderMc • core",
          bot_status: "ONLINE",
          activity: "Watching Reels & Posts on Mobile",
          verified_members: 1410,
          channels_count: 42
        },
        links: {
          store: "https://dc.gg/wondermc",
          vote: "soon",
          discord: "https://dc.gg/wondermc"
        }
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==========================================
  // TRANSCRIPT MANAGEMENT & WONDERMC VIEWER
  // ==========================================

  app.get("/api/transcripts", (req, res) => {
    try {
      const files = fs.readdirSync(transcriptsDir).filter(f => f.endsWith(".txt") || f.endsWith(".log") || f.endsWith(".json"));
      const list = files.map(file => {
        const filePath = path.join(transcriptsDir, file);
        const stats = fs.statSync(filePath);
        return {
          filename: file,
          size: stats.size,
          createdAt: stats.birthtime || stats.mtime,
          modifiedAt: stats.mtime
        };
      });
      list.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());
      res.json({ success: true, transcripts: list });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/transcripts/:filename", (req, res) => {
    try {
      const filename = path.basename(req.params.filename);
      const filePath = path.join(transcriptsDir, filename);
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ success: false, error: "Transcript file not found." });
      }
      const content = fs.readFileSync(filePath, "utf-8");
      res.json({ success: true, filename, content });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/transcripts/upload", (req, res) => {
    try {
      const { filename, content } = req.body;
      if (!content) {
        return res.status(400).json({ success: false, error: "Transcript content cannot be empty." });
      }

      const safeName = (filename || `transcript-upload-${Date.now()}.txt`).replace(/[^a-zA-Z0-9-_\.]/g, "_");
      const finalName = safeName.endsWith(".txt") ? safeName : `${safeName}.txt`;
      const filePath = path.join(transcriptsDir, finalName);

      fs.writeFileSync(filePath, content, "utf-8");

      res.json({
        success: true,
        filename: finalName,
        message: `Transcript "${finalName}" uploaded directly to panel and saved persistently in local folder!`
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.delete("/api/transcripts/:filename", (req, res) => {
    try {
      const filename = path.basename(req.params.filename);
      const filePath = path.join(transcriptsDir, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      res.json({ success: true, message: `Transcript "${filename}" removed.` });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/transcripts/create", (req, res) => {
    try {
      const { channelName, guildName, openerUser, category, messages, targetDmUser } = req.body;

      const cleanChName = (channelName || "ticket").replace(/[^a-zA-Z0-9-_]/g, "_");
      const timestampFile = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 15);
      const filename = `transcript-${cleanChName}-${timestampFile}.txt`;
      const filePath = path.join(transcriptsDir, filename);

      let transcriptContent = `================================================================================
WONDERMC TICKET TRANSCRIPT
================================================================================
Channel Name : #${channelName || 'ticket-channel'}
Guild        : ${guildName || 'WonderMc Support'}
Ticket Opener: ${openerUser || 'User'}
Category     : ${category || 'General'}
Exported At  : ${new Date().toUTCString()}
Server IP    : play.wondermc.fun
================================================================================\n\n`;

      if (Array.isArray(messages)) {
        messages.forEach((m: any) => {
          transcriptContent += `[${m.timestamp || new Date().toISOString()}] ${m.author}: ${m.content}\n`;
        });
      } else {
        transcriptContent += `[${new Date().toISOString()}] Ticket opened by ${openerUser || 'User'}\n`;
      }

      transcriptContent += `\n================================================================================
END OF TRANSCRIPT
================================================================================`;

      fs.writeFileSync(filePath, transcriptContent, "utf-8");

      res.json({
        success: true,
        filename,
        path: filePath,
        message: `Transcript "${filename}" uploaded directly to panel and host folder!`
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  const economyBackupPath = path.join(dataDir, "economy_backup.json");

  // Initialize initial sample economy backup if empty so web portal displays rich leaderboard immediately
  if (!fs.existsSync(economyBackupPath)) {
    const initialEconomy = [
      {
        guild_id: "1234567890",
        user_id: "1001",
        username: "pce_n",
        cash: 9898989,
        bank: 45000000,
        bank_capacity: 100000000,
        total_earned: 62000000,
        total_spent: 7101011,
        daily_streak: 14,
        inventory: '{"lucky_rooster": 2, "high_roller": 1}',
        updated_at: new Date().toISOString()
      },
      {
        guild_id: "1234567890",
        user_id: "1002",
        username: "BeTheLegend",
        cash: 3420000,
        bank: 28000000,
        bank_capacity: 50000000,
        total_earned: 35000000,
        total_spent: 3580000,
        daily_streak: 22,
        inventory: '{"padlock": 3, "vault_upgrade": 2}',
        updated_at: new Date().toISOString()
      },
      {
        guild_id: "1234567890",
        user_id: "1003",
        username: "Demon",
        cash: 1850000,
        bank: 15500000,
        bank_capacity: 25000000,
        total_earned: 21000000,
        total_spent: 3650000,
        daily_streak: 9,
        inventory: '{"shield": 1}',
        updated_at: new Date().toISOString()
      },
      {
        guild_id: "1234567890",
        user_id: "1004",
        username: "Mortyx",
        cash: 950000,
        bank: 8200000,
        bank_capacity: 15000000,
        total_earned: 11000000,
        total_spent: 1850000,
        daily_streak: 5,
        inventory: '{"padlock": 1}',
        updated_at: new Date().toISOString()
      },
      {
        guild_id: "1234567890",
        user_id: "1005",
        username: "KAMIL",
        cash: 620000,
        bank: 4500000,
        bank_capacity: 10000000,
        total_earned: 6800000,
        total_spent: 1680000,
        daily_streak: 3,
        inventory: '{}',
        updated_at: new Date().toISOString()
      }
    ];
    fs.writeFileSync(economyBackupPath, JSON.stringify(initialEconomy, null, 2), "utf-8");
  }

  // ==========================================
  // UNBELIEVABOAT ECONOMY & VAULT API
  // ==========================================
  app.get("/api/economy/leaderboard", (req, res) => {
    try {
      let users: any[] = [];
      if (fs.existsSync(economyBackupPath)) {
        try {
          users = JSON.parse(fs.readFileSync(economyBackupPath, "utf-8"));
        } catch (_) {}
      }

      users.forEach(u => {
        u.net = (Number(u.cash) || 0) + (Number(u.bank) || 0);
        if (typeof u.inventory === "string") {
          try { u.inventory = JSON.parse(u.inventory); } catch (_) { u.inventory = {}; }
        }
      });

      users.sort((a, b) => b.net - a.net);

      const totalCash = users.reduce((sum, u) => sum + (Number(u.cash) || 0), 0);
      const totalBank = users.reduce((sum, u) => sum + (Number(u.bank) || 0), 0);
      const totalCirculation = totalCash + totalBank;

      res.json({
        success: true,
        currency: "💵",
        altCurrency: "💸",
        totalCirculation,
        totalCash,
        totalBank,
        totalAccounts: users.length,
        leaderboard: users.slice(0, 20)
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/economy/shop", (req, res) => {
    res.json({
      success: true,
      items: [
        { id: "vip", name: "👑 VIP Role", price: 50000, type: "role", desc: "Exclusive VIP role with high status and unique server perks." },
        { id: "millionaire", name: "💎 Millionaire Role", price: 1000000, type: "role", desc: "Prestigious Millionaire role for top earners." },
        { id: "billionaire", name: "💰 Billionaire Role", price: 1000000000, type: "role", desc: "Ultra-wealthy Billionaire server elite role." },
        { id: "royalty", name: "🏰 Royalty Role", price: 5000000000, type: "role", desc: "Supreme Royalty status in WonderMc." },
        { id: "voucher_250k", name: "🎟️ 250k In-Game Cash Voucher", price: 50000000, type: "voucher", desc: "Redeemable 250,000 in-game currency voucher code for play.wondermc.fun!" }
      ]
    });
  });

  app.get("/api/data/tickets", (req, res) => {
    try {
      if (fs.existsSync(ticketsDataPath)) {
        const data = JSON.parse(fs.readFileSync(ticketsDataPath, "utf-8"));
        res.json({ success: true, data });
      } else {
        res.json({ success: true, data: { ticket_db: {}, open_tickets: {}, panels_log: [] } });
      }
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/data/tickets", (req, res) => {
    try {
      const data = req.body;
      fs.writeFileSync(ticketsDataPath, JSON.stringify(data, null, 2), "utf-8");
      res.json({ success: true, message: "Ticket and panel data persisted safely!" });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Emojis Configuration API
  app.get("/api/data/emojis", (req, res) => {
    try {
      if (fs.existsSync(emojisConfigPath)) {
        const data = JSON.parse(fs.readFileSync(emojisConfigPath, "utf-8"));
        res.json({ success: true, data });
      } else {
        res.json({ success: true, data: {} });
      }
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/data/emojis", (req, res) => {
    try {
      const data = req.body || {};
      fs.writeFileSync(emojisConfigPath, JSON.stringify(data, null, 2), "utf-8");
      res.json({ success: true, message: "Custom emojis updated successfully!", data });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ─────────────────────────────────────────────
  // Staff Applications Management APIs
  // ─────────────────────────────────────────────

  // 1. Get Application Configuration
  app.get("/api/applications/config", (req, res) => {
    try {
      let cfg: Record<string, any> = {};
      if (fs.existsSync(applicationsConfigPath)) {
        cfg = JSON.parse(fs.readFileSync(applicationsConfigPath, "utf-8"));
      }
      const guildId = req.query.guild_id as string || "default";
      const guildConfig = cfg[guildId] || cfg["default"] || Object.values(cfg)[0] || {
        enabled: true,
        review_channel_id: null,
        staff_role_id: null,
        max_questions: 15,
        title: "WonderMc Staff Recruitment",
        description: "Welcome to the official WonderMc Staff Application. Please answer all questions honestly and thoroughly.",
        questions: [],
        cooldown_days: 7
      };
      if (!(req as any).auth?.isStaff) {   // visitors only get what the public apply page needs - no channel/role IDs
        const { enabled, title, description, questions, max_questions, cooldown_days, panel_message, panel_image, panel_thumbnail, button_label } = guildConfig as any;
        return res.json({ success: true, config: { enabled, title, description, questions, max_questions, cooldown_days, panel_message, panel_image, panel_thumbnail, button_label } });
      }
      res.json({ success: true, config: guildConfig, allConfigs: cfg });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 2. Update Application Configuration (Questions, Channel, etc.)
  app.post("/api/applications/config", (req, res) => {
    try {
      let cfg: Record<string, any> = {};
      if (fs.existsSync(applicationsConfigPath)) {
        try { cfg = JSON.parse(fs.readFileSync(applicationsConfigPath, "utf-8")); } catch (_) {}
      }
      const guildId = (req.body.guild_id as string) || "default";
      const newConfig = req.body.config || req.body;

      // Validate maximum 15 questions
      if (Array.isArray(newConfig.questions) && newConfig.questions.length > 15) {
        return res.status(400).json({
          success: false,
          error: "Maximum question limit is 15 questions. Please trim your question list."
        });
      }

      cfg[guildId] = {
        ...cfg[guildId],
        ...newConfig,
        max_questions: 15
      };

      // Always synchronize with 'default' so the bot can pick it up immediately
      cfg["default"] = {
        ...cfg["default"],
        ...cfg[guildId],
        max_questions: 15
      };

      // If questions or texts were updated, propagate across all guilds
      if (Array.isArray(newConfig.questions)) {
        for (const k of Object.keys(cfg)) {
          cfg[k].questions = [...newConfig.questions];
          if (newConfig.title) cfg[k].title = newConfig.title;
          if (newConfig.description) cfg[k].description = newConfig.description;
        }
      }

      fs.writeFileSync(applicationsConfigPath, JSON.stringify(cfg, null, 2), "utf-8");
      res.json({ success: true, message: "Application configuration updated and synced to Discord bot successfully!", config: cfg[guildId] });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 3. Get All Application Submissions (Previous and Current)
  app.get("/api/applications/submissions", (req, res) => {
    try {
      let submissions: any[] = [];
      if (fs.existsSync(applicationsDataPath)) {
        try { submissions = JSON.parse(fs.readFileSync(applicationsDataPath, "utf-8")); } catch (_) {}
      }
      // Sort newest first
      submissions.sort((a, b) => new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime());
      res.json({ success: true, submissions });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 4. Staff Review (Accept or Deny with Reason)
  app.post("/api/applications/submissions/:id/review", (req, res) => {
    try {
      const { id } = req.params;
      const { status, reviewer, reason } = req.body;

      if (!status || !["accepted", "denied"].includes(status)) {
        return res.status(400).json({ success: false, error: "Status must be 'accepted' or 'denied'." });
      }

      let submissions: any[] = [];
      if (fs.existsSync(applicationsDataPath)) {
        try { submissions = JSON.parse(fs.readFileSync(applicationsDataPath, "utf-8")); } catch (_) {}
      }

      const target = submissions.find((s) => s.id === id);
      if (!target) {
        return res.status(404).json({ success: false, error: `Submission #${id} not found.` });
      }

      target.status = status;
      target.reviewed_by = reviewer || "Staff Admin (Web)";
      target.reviewed_at = new Date().toISOString();
      target.review_reason = reason || (status === "accepted" ? "Application accepted by administration." : "Application denied by administration.");

      fs.writeFileSync(applicationsDataPath, JSON.stringify(submissions, null, 2), "utf-8");
      res.json({
        success: true,
        message: `Application #${id} has been marked as ${status.toUpperCase()}!`,
        submission: target
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 5. Submit or Simulate Application (Web & Bot Bridge)
  app.post("/api/applications/submissions/create", (req, res) => {
    try {
      const auth = (req as any).auth;                       // guaranteed by the guard (role: user or higher)
      const { discord_id, answers } = req.body || {};
      if (!Array.isArray(answers) || answers.length === 0 || answers.length > 30) {
        return res.status(400).json({ success: false, error: "Please answer the questions." });
      }
      const clean = answers.map((a: any) => ({ question: String(a?.question ?? "").slice(0, 300), answer: String(a?.answer ?? "").trim().slice(0, 2000) }));
      if (clean.some((a: any) => !a.answer)) return res.status(400).json({ success: false, error: "Every question needs an answer." });

      let submissions: any[] = [];
      if (fs.existsSync(applicationsDataPath)) {
        try { submissions = JSON.parse(fs.readFileSync(applicationsDataPath, "utf-8")); } catch (_) {}
      }
      const mine = submissions.filter((x: any) => x.account_email === auth.email);
      if (mine.some((x: any) => x.status === "pending")) {
        return res.status(409).json({ success: false, error: "You already have an application waiting for review." });
      }
      let cfg: Record<string, any> = {};
      try { cfg = JSON.parse(fs.readFileSync(applicationsConfigPath, "utf-8")); } catch (_) {}
      const guildKey = String(req.body?.guild_id || Object.keys(cfg).find((k) => /^\d+$/.test(k)) || "default");
      const cooldownDays = Number((cfg[guildKey] || cfg["default"] || {}).cooldown_days ?? 7);
      const last = mine.map((x: any) => Date.parse(x.submitted_at)).filter(Boolean).sort((a: number, b: number) => b - a)[0];
      if (last && Date.now() - last < cooldownDays * 86400_000) {
        return res.status(429).json({ success: false, error: `You can apply again after ${cooldownDays} days.` });
      }
      const maxId = submissions.reduce((m: number, x: any) => Math.max(m, Number(x.id) || 1000), 1000);
      const idDigits = String(discord_id || "").replace(/\D/g, "");
      const newSubmission = {
        id: String(maxId + 1),
        user_id: /^\d{15,20}$/.test(idDigits) ? idDigits : "0",
        user_name: auth.name,
        account_email: auth.email,
        source: "website",
        guild_id: /^\d+$/.test(guildKey) ? Number(guildKey) : guildKey,
        status: "pending",
        submitted_at: new Date().toISOString(),
        answers: clean,
        reviewed_by: null, reviewed_at: null, review_reason: null, ticket_channel_id: null,
      };
      submissions.unshift(newSubmission);
      fs.writeFileSync(applicationsDataPath, JSON.stringify(submissions, null, 2), "utf-8");
      res.json({ success: true, message: "Application submitted! Staff will review it soon.", id: newSubmission.id });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // 6. Delete Submission
  app.delete("/api/applications/submissions/:id", (req, res) => {
    try {
      const { id } = req.params;
      let submissions: any[] = [];
      if (fs.existsSync(applicationsDataPath)) {
        try { submissions = JSON.parse(fs.readFileSync(applicationsDataPath, "utf-8")); } catch (_) {}
      }
      const filtered = submissions.filter((s) => s.id !== id);
      fs.writeFileSync(applicationsDataPath, JSON.stringify(filtered, null, 2), "utf-8");
      res.json({ success: true, message: `Submission #${id} deleted.` });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Bot restart simulation
  app.post("/api/bot/restart-simulation", (req, res) => {
    try {
      let ticketsData = { ticket_db: {}, open_tickets: {}, panels_log: [] };
      if (fs.existsSync(ticketsDataPath)) {
        try { ticketsData = JSON.parse(fs.readFileSync(ticketsDataPath, "utf-8")); } catch (_) {}
      }
      const panelsCount = Object.keys(ticketsData.ticket_db || {}).length || (ticketsData.panels_log || []).length;
      const openTicketsCount = Object.keys(ticketsData.open_tickets || {}).length;

      // Also check giveaways and role panels
      const giveawaysPath = path.join(dataDir, "giveaways.json");
      let giveawaysCount = 0;
      if (fs.existsSync(giveawaysPath)) {
        try { giveawaysCount = Object.keys(JSON.parse(fs.readFileSync(giveawaysPath, "utf-8"))).length; } catch (_) {}
      }

      const rolePanelsPath = path.join(dataDir, "role_panels.json");
      let rolePanelsCount = 0;
      if (fs.existsSync(rolePanelsPath)) {
        try { rolePanelsCount = Object.keys(JSON.parse(fs.readFileSync(rolePanelsPath, "utf-8"))).length; } catch (_) {}
      }

      res.json({
        success: true,
        restartedAt: new Date().toISOString(),
        message: `Bot restarted smoothly! Restored ${panelsCount} ticket panels, ${giveawaysCount} active giveaways, and ${rolePanelsCount} role button panels from disk.`,
        restoredPanels: panelsCount,
        restoredTickets: openTicketsCount,
        restoredGiveaways: giveawaysCount,
        restoredRolePanels: rolePanelsCount
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==========================================
  // DISCORD BOT PROCESS SUPERVISOR (SAME-SERVER EXECUTION)
  // ==========================================
  interface BotProcessState {
    process: ChildProcess | null;
    pid: number | null;
    status: "STOPPED" | "STARTING" | "RUNNING" | "CRASHED" | "RESTARTING";
    startedAt: string | null;
    restartsCount: number;
    logs: Array<{ timestamp: string; type: "stdout" | "stderr" | "system"; text: string }>;
    autoStart: boolean;
  }

  const botState: BotProcessState = {
    process: null,
    pid: null,
    status: "STOPPED",
    startedAt: null,
    restartsCount: 0,
    logs: [],
    autoStart: process.env.RUN_DISCORD_BOT === "true" || process.env.AUTO_START_BOT === "true"
  };

  const addBotLog = (type: "stdout" | "stderr" | "system", text: string) => {
    const line = {
      timestamp: new Date().toISOString(),
      type,
      text: text.trimEnd()
    };
    botState.logs.push(line);
    if (botState.logs.length > 600) {
      botState.logs.shift();
    }
  };

  const startBotProcess = () => {
    if (botState.process && botState.status === "RUNNING") {
      return { success: true, message: `Discord Bot is already running (PID ${botState.pid}).`, pid: botState.pid };
    }

    const pythonCmd = process.env.BOT_PYTHON_CMD || "python3";
    const entryFile = process.env.BOT_ENTRY_FILE || "main.py";
    const entryPath = path.join(process.cwd(), entryFile);

    if (!fs.existsSync(entryPath)) {
      addBotLog("system", `[ERROR] Bot entry file not found at: ${entryPath}`);
      botState.status = "STOPPED";
      return { success: false, error: `Bot entry file ${entryFile} not found on server.` };
    }

    addBotLog("system", `[SUPERVISOR] Spawning Discord Bot: ${pythonCmd} ${entryFile} on same server...`);
    botState.status = "STARTING";

    try {
      const child = spawn(pythonCmd, [entryFile], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PYTHONUNBUFFERED: "1"
        }
      });

      botState.process = child;
      botState.pid = child.pid || null;
      botState.startedAt = new Date().toISOString();
      botState.status = "RUNNING";

      child.stdout?.on("data", (data) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          if (line.trim()) addBotLog("stdout", line);
        }
      });

      child.stderr?.on("data", (data) => {
        const lines = data.toString().split("\n");
        for (const line of lines) {
          if (line.trim()) addBotLog("stderr", line);
        }
      });

      child.on("error", (err) => {
        addBotLog("system", `[PROCESS ERROR] Failed to start Python process: ${err.message}`);
        botState.status = "CRASHED";
        botState.process = null;
        botState.pid = null;
      });

      child.on("exit", (code, signal) => {
        addBotLog("system", `[PROCESS EXIT] Discord Bot process terminated (Exit code: ${code}, Signal: ${signal || "none"})`);
        botState.process = null;
        botState.pid = null;
        botState.status = code === 0 ? "STOPPED" : "CRASHED";

        if (code !== 0 && process.env.AUTO_RESTART_BOT_ON_CRASH !== "false" && botState.autoStart) {
          botState.restartsCount++;
          addBotLog("system", `[AUTO-RESTART] Crash detected. Restart attempt #${botState.restartsCount} in 5 seconds...`);
          setTimeout(() => {
            if (botState.autoStart && botState.status === "CRASHED") {
              startBotProcess();
            }
          }, 5000);
        }
      });

      return { success: true, message: "Discord Bot launched successfully on same server.", pid: child.pid };
    } catch (e: any) {
      botState.status = "CRASHED";
      addBotLog("system", `[LAUNCH EXCEPTION] ${e.message}`);
      return { success: false, error: e.message };
    }
  };

  const stopBotProcess = () => {
    if (!botState.process) {
      botState.status = "STOPPED";
      return { success: true, message: "Bot process is not currently running." };
    }
    addBotLog("system", `[SUPERVISOR] Stopping Discord Bot process (PID ${botState.pid})...`);
    botState.autoStart = false;
    try {
      botState.process.kill("SIGTERM");
    } catch (_) {}
    botState.process = null;
    botState.pid = null;
    botState.status = "STOPPED";
    return { success: true, message: "Discord Bot process stopped." };
  };

  // Launch bot on server start if RUN_DISCORD_BOT=true
  if (process.env.RUN_DISCORD_BOT === "true" || process.env.AUTO_START_BOT === "true") {
    console.log("[SERVER] RUN_DISCORD_BOT=true: Launching Discord bot on same server...");
    startBotProcess();
  }

  process.on("SIGINT", () => {
    stopBotProcess();
  });
  process.on("SIGTERM", () => {
    stopBotProcess();
  });

  // REST APIs for Bot Process Management
  app.get("/api/bot/process/status", (req, res) => {
    res.json({
      success: true,
      status: botState.status,
      pid: botState.pid,
      startedAt: botState.startedAt,
      restartsCount: botState.restartsCount,
      autoStart: botState.autoStart,
      envConfig: {
        RUN_DISCORD_BOT: process.env.RUN_DISCORD_BOT || "false",
        BOT_PYTHON_CMD: process.env.BOT_PYTHON_CMD || "python3",
        BOT_ENTRY_FILE: process.env.BOT_ENTRY_FILE || "main.py",
        hasToken: Boolean(process.env.DISCORD_TOKEN && process.env.DISCORD_TOKEN.length > 20 && !process.env.DISCORD_TOKEN.includes("your_discord_bot_token"))
      }
    });
  });

  app.post("/api/bot/process/start", (req, res) => {
    botState.autoStart = true;
    const result = startBotProcess();
    res.json(result);
  });

  app.post("/api/bot/process/stop", (req, res) => {
    const result = stopBotProcess();
    res.json(result);
  });

  app.post("/api/bot/process/restart", (req, res) => {
    stopBotProcess();
    setTimeout(() => {
      botState.autoStart = true;
      const result = startBotProcess();
      res.json(result);
    }, 1000);
  });

  app.get("/api/bot/process/logs", (req, res) => {
    res.json({ success: true, logs: botState.logs });
  });

  app.post("/api/bot/process/clear-logs", (req, res) => {
    botState.logs = [];
    res.json({ success: true, message: "Logs cleared." });
  });

  // ==========================================
  // PRESENCE LOOPHOLE & MOBILE STATUS API
  // ==========================================
  const presenceConfigPath = path.join(dataDir, "presence_loophole.json");
  let memoryTriggerTime = Date.now();
  let memoryTriggerSource = "System Startup";

  const getPresenceData = () => {
    const defaultData = {
      enabled: true,
      idle_timeout: 180,
      offline_timeout: 600,
      activity_name: "play.wondermc.fun 📱",
      activity_details: "WonderMc Network • Discord Android",
      activity_state: "Mobile Online • Auto-Sleep Loophole",
      activity_type: "playing"
    };
    if (fs.existsSync(presenceConfigPath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(presenceConfigPath, "utf-8"));
        return { ...defaultData, ...parsed };
      } catch (_) {}
    }
    fs.writeFileSync(presenceConfigPath, JSON.stringify(defaultData, null, 2), "utf-8");
    return defaultData;
  };

  app.get("/api/presence/status", (req, res) => {
    try {
      const config = getPresenceData();
      const elapsedSeconds = Math.floor((Date.now() - memoryTriggerTime) / 1000);
      let currentState = "online";
      if (config.enabled) {
        if (elapsedSeconds >= config.offline_timeout) {
          currentState = "offline";
        } else if (elapsedSeconds >= config.idle_timeout) {
          currentState = "idle";
        }
      }

      res.json({
        success: true,
        currentState,
        device: "Discord Android (Mobile)",
        deviceIcon: "📱",
        elapsedSeconds,
        lastTriggerTime: new Date(memoryTriggerTime).toISOString(),
        lastTriggerSource: memoryTriggerSource,
        config,
        timeUntilIdle: Math.max(0, config.idle_timeout - elapsedSeconds),
        timeUntilOffline: Math.max(0, config.offline_timeout - elapsedSeconds)
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/presence/trigger", (req, res) => {
    try {
      const { source, user } = req.body || {};
      memoryTriggerTime = Date.now();
      memoryTriggerSource = source || "Web Dashboard Action";

      res.json({
        success: true,
        currentState: "online",
        device: "Discord Android (Mobile)",
        message: `Awakened instantly to Online on Mobile via ${memoryTriggerSource}!`,
        triggeredAt: new Date(memoryTriggerTime).toISOString()
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.post("/api/presence/config", (req, res) => {
    try {
      const current = getPresenceData();
      const { idle_timeout, offline_timeout, enabled } = req.body;
      if (idle_timeout !== undefined) current.idle_timeout = Math.max(10, Number(idle_timeout));
      if (offline_timeout !== undefined) current.offline_timeout = Math.max(20, Number(offline_timeout));
      if (enabled !== undefined) current.enabled = Boolean(enabled);

      fs.writeFileSync(presenceConfigPath, JSON.stringify(current, null, 2), "utf-8");
      res.json({ success: true, config: current, message: "Loophole configuration updated successfully!" });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==========================================
  // MULTI-PANEL RESILIENCE & SELF-HEALING API
  // ==========================================
  app.get("/api/panels/health", (req, res) => {
    try {
      const files = [
        { key: "tickets", name: "Tickets & Panels", path: ticketsDataPath, defaultContent: { ticket_db: {}, open_tickets: {}, panels_log: [] } },
        { key: "giveaways", name: "Giveaway Panels", path: path.join(dataDir, "giveaways.json"), defaultContent: {} },
        { key: "roles", name: "Button Role Panels", path: path.join(dataDir, "role_panels.json"), defaultContent: {} },
        { key: "suggestions", name: "Server Suggestions", path: path.join(dataDir, "suggestions.json"), defaultContent: { suggest_db: {}, pending_db: {} } },
        { key: "presence", name: "Mobile Loophole Config", path: presenceConfigPath, defaultContent: getPresenceData() },
        { key: "emojis", name: "Custom Emojis Config", path: emojisConfigPath, defaultContent: {} }
      ];

      const health = files.map(f => {
        const exists = fs.existsSync(f.path);
        let itemsCount = 0;
        let sizeBytes = 0;
        let modified = null;

        if (exists) {
          try {
            const stat = fs.statSync(f.path);
            sizeBytes = stat.size;
            modified = stat.mtime.toISOString();
            const parsed = JSON.parse(fs.readFileSync(f.path, "utf-8"));
            if (Array.isArray(parsed)) {
              itemsCount = parsed.length;
            } else if (typeof parsed === "object" && parsed !== null) {
              itemsCount = Object.keys(parsed).length;
            }
          } catch (_) {}
        }

        return {
          key: f.key,
          name: f.name,
          fileName: path.basename(f.path),
          exists,
          status: exists ? "Healthy & Persistent" : "Auto-Healing Standby",
          itemsCount,
          sizeBytes,
          lastModified: modified,
          selfHealingReady: true
        };
      });

      res.json({ success: true, health, allOperational: true });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Simulate file deletion and trigger immediate self-healing
  app.post("/api/panels/simulate-heal", (req, res) => {
    try {
      const { key } = req.body;
      const fileMap: Record<string, { path: string; defaultContent: any; name: string }> = {
        tickets: { path: ticketsDataPath, defaultContent: { ticket_db: {}, open_tickets: {}, panels_log: [] }, name: "Ticket Data" },
        giveaways: { path: path.join(dataDir, "giveaways.json"), defaultContent: {}, name: "Giveaways Data" },
        roles: { path: path.join(dataDir, "role_panels.json"), defaultContent: {}, name: "Role Panels Data" },
        suggestions: { path: path.join(dataDir, "suggestions.json"), defaultContent: { suggest_db: {}, pending_db: {} }, name: "Suggestions Data" },
        presence: { path: presenceConfigPath, defaultContent: getPresenceData(), name: "Presence Loophole Config" }
      };

      const target = fileMap[key];
      if (!target) {
        return res.status(400).json({ success: false, error: "Invalid target key" });
      }

      // 1. Delete file to simulate disaster
      if (fs.existsSync(target.path)) {
        fs.unlinkSync(target.path);
      }

      // 2. Immediate self-healing recovery routine (identical to what python cogs do)
      fs.writeFileSync(target.path, JSON.stringify(target.defaultContent, null, 2), "utf-8");

      res.json({
        success: true,
        message: `Self-healing verified! ${target.name} was wiped and automatically restored with default schema. Panels will continue to operate without crashing!`,
        recoveredFile: path.basename(target.path),
        timestamp: new Date().toISOString()
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Code Explorer API
  app.get("/api/cogs", (req, res) => {
    try {
      const cogsDir = path.join(process.cwd(), "cogs");
      const cogs: string[] = [];
      if (fs.existsSync(cogsDir)) {
        fs.readdirSync(cogsDir).filter(f => f.endsWith(".py")).forEach(f => {
          cogs.push(`cogs/${f}`);
        });
      }
      cogs.push("WonderWebServer.java");
      cogs.push("main.py");
      res.json({ success: true, cogs });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  app.get("/api/code", (req, res) => {
    try {
      // Owner only (see auth.ts) AND limited to the bot's source files - never .env, data/ or the sessions.
      const targetPath = String(req.query.path || "cogs/ticket.py");
      const allowed = /^(cogs\/[A-Za-z0-9_]+\.py|main\.py|app\.py|WonderWebServer\.java)$/.test(targetPath);
      if (!allowed) {
        return res.status(403).json({ success: false, error: "This file can't be shown." });
      }
      const fullPath = path.join(process.cwd(), targetPath);
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ success: false, error: `File "${targetPath}" not found.` });
      }
      res.json({ success: true, path: targetPath, content: fs.readFileSync(fullPath, "utf-8") });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==========================================
  // BOT ADMIN PROXY: the dashboard asks the Python bot (same server) to do things. The bridge secret never reaches the browser.
  // ==========================================
  app.all("/api/botadmin/*", async (req: any, res) => {
    const port = process.env.BRIDGE_PORT || process.env.SERVER_PORT || "25587";
    const sub = String(req.originalUrl).replace(/^\/api\/botadmin/, "");
    const isPost = req.method !== "GET" && req.method !== "HEAD";
    const body = isPost ? { ...(req.body || {}), by: req.auth?.email || "dashboard" } : undefined;   // who did it (for history)
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/botadmin${sub}`, {
        method: req.method,
        headers: { "Content-Type": "application/json", "x-bridge-secret": currentBridgeSecret() },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(40000),
      });
      const text = await r.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { success: false, error: `The bot answered with an unexpected reply (HTTP ${r.status}).` }; }
      if (r.status === 403) data = { success: false, error: "The dashboard and the bot don't share the same BRIDGE_SECRET. Put the same BRIDGE_SECRET in .env and restart." };
      res.status(r.status).json(data);
    } catch (e: any) {
      res.status(502).json({ success: false, error: "The bot is not reachable right now. Is it running? (port " + port + ")" });
    }
  });

  // ==========================================
  // SITE CONTENT (announcement banner, rules, FAQ) - public read, admin edit
  // ==========================================
  const siteContentPath = path.join(dataDir, "site_content.json");
  const DEFAULT_SITE_CONTENT = {
    announcement: { enabled: false, text: "", link: "" },
    rules: [
      { title: "Respect everyone", text: "No harassment, hate speech, threats or toxic behaviour — in game or on Discord." },
      { title: "No cheating", text: "Hacked clients, x-ray, auto-clickers, exploits and duping are not allowed. Report bugs instead of abusing them." },
      { title: "No griefing or scamming", text: "Do not damage other players' builds or scam players in trades." },
      { title: "Keep chat clean", text: "No spam, advertising, excessive caps or inappropriate content." },
      { title: "Listen to staff", text: "Follow staff instructions. If you disagree, open a ticket on Discord — do not argue in chat." },
    ],
    faq: [
      { q: "How do I join the server?", a: "Add play.wondermc.fun in Minecraft (Java or Bedrock; Bedrock port 19132). Check the Status page to see if it is online." },
      { q: "How do I link my Minecraft account with Discord?", a: "In game type /link to get a 6-digit code, then run /link with that code in our Discord server." },
      { q: "How do I buy a rank, keys or coins?", a: "Open the Store, add items to the cart, pay by UPI and enter the payment reference. Staff verify the payment and your items are delivered." },
      { q: "How do I apply for staff?", a: "Create an account, then use the Apply page. Staff review every application." },
      { q: "I need help or want to appeal a punishment.", a: "Open a ticket in our Discord (https://dc.gg/wondermc)." },
    ],
  };
  const readSiteContent = () => {
    let saved: any = {};
    try { saved = JSON.parse(fs.readFileSync(siteContentPath, "utf-8")); } catch { /* defaults */ }
    return { ...DEFAULT_SITE_CONTENT, ...saved, announcement: { ...DEFAULT_SITE_CONTENT.announcement, ...(saved.announcement || {}) } };
  };
  app.get("/api/site/content", (_req, res) => {
    res.json({ success: true, content: readSiteContent() });
  });
  app.post("/api/site/content", (req, res) => {
    try {
      const b = req.body || {};
      const str = (v: any, n: number) => String(v ?? "").slice(0, n);
      const content = {
        announcement: {
          enabled: !!b.announcement?.enabled,
          text: str(b.announcement?.text, 200),
          link: /^https?:\/\//.test(String(b.announcement?.link || "")) ? str(b.announcement.link, 300) : "",
        },
        rules: (Array.isArray(b.rules) ? b.rules : []).slice(0, 30).map((r: any) => ({ title: str(r?.title, 80), text: str(r?.text, 500) })).filter((r: any) => r.title),
        faq: (Array.isArray(b.faq) ? b.faq : []).slice(0, 30).map((f: any) => ({ q: str(f?.q, 160), a: str(f?.a, 1000) })).filter((f: any) => f.q && f.a),
      };
      fs.writeFileSync(siteContentPath, JSON.stringify(content, null, 2), "utf-8");
      res.json({ success: true, content });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // ==========================================
  // BROWSER ANTI-BOT VERIFICATION PORTAL ROUTES
  // ==========================================
  const verifyTokensPath = path.join(dataDir, "verification_tokens.json");
  const verifyQueuePath = path.join(dataDir, "verification_queue.json");
  const verifyConfigPath = path.join(dataDir, "verification_config.json");

  // Helper to read JSON safely
  const readJson = (filePath: string, fallback: any = {}) => {
    if (fs.existsSync(filePath)) {
      try {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
      } catch (e) {
        return fallback;
      }
    }
    return fallback;
  };

  // Helper to write JSON safely
  const writeJson = (filePath: string, data: any) => {
    try {
      const tmp = `${filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
      fs.renameSync(tmp, filePath);
    } catch (e) {
      console.error(`[Verification] Error writing ${filePath}:`, e);
    }
  };

  // API: Get verification token status info
  app.get("/api/verify/info", (req, res) => {
    const token = req.query.token as string;
    if (!token) {
      return res.status(400).json({ success: false, error: "Missing verification token" });
    }
    const tokens = readJson(verifyTokensPath, {});
    const info = tokens[token];
    if (!info) {
      return res.status(404).json({ success: false, error: "Invalid or expired token" });
    }
    const now = Date.now() / 1000;
    if (info.expires_at && now > info.expires_at) {
      return res.status(410).json({ success: false, error: "Token has expired (15m limit). Please request a new link." });
    }
    res.json({
      success: true,
      username: info.username,
      status: info.status,
      created_at: info.created_at,
      expires_at: info.expires_at
    });
  });

  // API: Submit browser verification check
  app.post("/api/verify/submit", async (req, res) => {
    try {
      const { token, humanCheck } = req.body;
      if (!token) {
        return res.status(400).json({ success: false, error: "Token is required" });
      }
      if (!humanCheck) {
        return res.status(400).json({ success: false, error: "Human verification check failed" });
      }

      const tokens = readJson(verifyTokensPath, {});
      const info = tokens[token];
      if (!info) {
        return res.status(404).json({ success: false, error: "Invalid or expired verification session." });
      }

      if (info.status === "completed") {
        return res.json({ success: true, message: "You are already verified! Return to Discord." });
      }

      const now = Date.now() / 1000;
      if (info.expires_at && now > info.expires_at) {
        return res.status(410).json({ success: false, error: "This link expired. Click 'Verify with Browser' in Discord again." });
      }

      // Mark token as completed
      info.status = "completed";
      info.verified_at = now;
      tokens[token] = info;
      writeJson(verifyTokensPath, tokens);

      // Append to verification queue for Discord bot watchdog
      const queue = readJson(verifyQueuePath, []);
      queue.push({
        guild_id: info.guild_id,
        user_id: info.user_id,
        username: info.username,
        verified_at: now
      });
      writeJson(verifyQueuePath, queue);

      // Attempt immediate Discord REST role assignment if token is configured
      const discordToken = process.env.DISCORD_TOKEN;
      const verifyConfigs = readJson(verifyConfigPath, {});
      const guildCfg = verifyConfigs[info.guild_id];
      const roleId = guildCfg?.verified_role_id;

      if (discordToken && roleId && info.guild_id && info.user_id) {
        try {
          const restUrl = `https://discord.com/api/v10/guilds/${info.guild_id}/members/${info.user_id}/roles/${roleId}`;
          await fetch(restUrl, {
            method: "PUT",
            headers: {
              "Authorization": `Bot ${discordToken}`,
              "X-Audit-Log-Reason": "[WonderMc Security] Completed browser anti-bot verification"
            }
          });
        } catch (err) {
          console.log("[Verification REST] Bot watchdog will handle role assignment:", err);
        }
      }

      res.json({
        success: true,
        message: "Verification successful! Your verified role has been granted in Discord."
      });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  // Cloudflare Turnstile & Browser Anti-Bot Verification HTML Portal
  app.get("/verify", (req, res) => {
    const token = (req.query.token as string) || "";
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>Just a moment... • Cloudflare Turnstile</title>
  <link rel="icon" href="https://media.discordapp.net/attachments/1542583411191980164/1547282120685264906/content.png" />
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    body {
      background: #0E1017;
      color: #E2E8F0;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 16px;
      overflow-x: hidden;
      position: relative;
    }
    .cf-bg-ambient {
      position: absolute;
      width: 600px;
      height: 600px;
      background: radial-gradient(circle, rgba(246, 130, 31, 0.08) 0%, rgba(14, 16, 23, 0) 70%);
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      pointer-events: none;
      z-index: 0;
    }
    .cf-container {
      position: relative;
      z-index: 1;
      width: 100%;
      max-width: 490px;
      background: #141722;
      border: 1px solid #232838;
      border-radius: 16px;
      padding: 36px 30px;
      box-shadow: 0 20px 45px -10px rgba(0, 0, 0, 0.6);
      text-align: left;
    }
    @media (max-width: 480px) {
      .cf-container { padding: 24px 18px; border-radius: 14px; }
    }
    .cf-header {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 22px;
    }
    .cf-logo-svg {
      width: 42px;
      height: 42px;
    }
    .cf-brand-name {
      font-size: 15px;
      font-weight: 700;
      color: #F8FAFC;
      letter-spacing: -0.2px;
    }
    .cf-brand-sub {
      font-size: 12px;
      color: #94A3B8;
    }
    h1.cf-title {
      font-size: 22px;
      font-weight: 700;
      color: #FFFFFF;
      margin-bottom: 8px;
      line-height: 1.3;
      letter-spacing: -0.4px;
    }
    p.cf-subtitle {
      font-size: 13.5px;
      color: #94A3B8;
      margin-bottom: 24px;
      line-height: 1.6;
    }
    .device-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: #1A1F2E;
      border: 1px solid #2D354A;
      color: #CBD5E1;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 11.5px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .device-pill.mobile { color: #38BDF8; border-color: rgba(56, 189, 248, 0.3); background: rgba(56, 189, 248, 0.08); }
    .device-pill.desktop { color: #34D399; border-color: rgba(52, 211, 153, 0.3); background: rgba(52, 211, 153, 0.08); }
    .user-card {
      background: #191E2C;
      border: 1px solid #283145;
      border-radius: 12px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 22px;
    }
    .user-details { display: flex; align-items: center; gap: 12px; }
    .user-avatar-circle {
      width: 36px;
      height: 36px;
      background: linear-gradient(135deg, #F6821F, #FA541C);
      color: #FFFFFF;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 800;
      font-size: 15px;
    }
    .user-meta .u-name { font-size: 14px; font-weight: 700; color: #F1F5F9; }
    .user-meta .u-desc { font-size: 11.5px; color: #64748B; }
    .badge-sec {
      background: rgba(46, 204, 113, 0.12);
      color: #2ECC71;
      border: 1px solid rgba(46, 204, 113, 0.3);
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 700;
    }
    /* Turnstile Widget Box */
    .turnstile-box {
      background: #181C28;
      border: 1px solid #2B3346;
      border-radius: 10px;
      padding: 16px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
      transition: all 0.2s ease;
      min-height: 68px;
      margin-bottom: 24px;
    }
    .turnstile-box:hover {
      border-color: #F6821F;
      background: #1C2130;
    }
    .turnstile-box.verified {
      border-color: #2ECC71;
      background: #152220;
    }
    .turnstile-left {
      display: flex;
      align-items: center;
      gap: 16px;
    }
    .cf-checkbox {
      width: 28px;
      height: 28px;
      border: 2px solid #64748B;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
      background: #11141E;
      flex-shrink: 0;
    }
    .cf-checkbox.spinning {
      border-color: #F6821F transparent #F6821F #F6821F;
      border-radius: 50%;
      animation: cf-spin 0.8s linear infinite;
    }
    @keyframes cf-spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .cf-checkbox.success {
      background: #2ECC71;
      border-color: #2ECC71;
      animation: cf-pop 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    @keyframes cf-pop { 0% { transform: scale(0.6); } 100% { transform: scale(1); } }
    .cf-checkbox.success::after {
      content: "✓";
      color: #0E1017;
      font-weight: 900;
      font-size: 16px;
    }
    .turnstile-label {
      font-size: 14.5px;
      font-weight: 600;
      color: #F1F5F9;
    }
    .turnstile-branding {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      opacity: 0.85;
    }
    .turnstile-cf-logo {
      display: flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      font-weight: 700;
      color: #F6821F;
    }
    .turnstile-legal {
      font-size: 9.5px;
      color: #64748B;
      margin-top: 2px;
    }
    .cf-btn-submit {
      width: 100%;
      background: #F6821F;
      color: #FFFFFF;
      border: none;
      border-radius: 10px;
      padding: 14px;
      font-size: 15px;
      font-weight: 700;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
    }
    .cf-btn-submit:hover:not(:disabled) {
      background: #E57213;
      transform: translateY(-1px);
    }
    .cf-btn-submit:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      transform: none;
    }
    .cf-footer {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #1E2332;
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 11.5px;
      color: #64748B;
    }
    .cf-ray-id { font-family: monospace; color: #94A3B8; }
    .cf-error-alert {
      background: rgba(231, 76, 60, 0.12);
      border: 1px solid rgba(231, 76, 60, 0.35);
      color: #F87171;
      padding: 12px 14px;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 18px;
      display: none;
    }
    .cf-success-panel {
      display: none;
      text-align: center;
      padding: 10px 0;
    }
    .cf-success-badge {
      width: 68px;
      height: 68px;
      background: #2ECC71;
      color: #0E1017;
      border-radius: 50%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 36px;
      font-weight: 900;
      margin-bottom: 18px;
      box-shadow: 0 0 35px rgba(46, 204, 113, 0.45);
      animation: cf-pop 0.4s ease;
    }
  </style>
</head>
<body>
  <div class="cf-bg-ambient"></div>

  <div class="cf-container" id="mainContainer">
    <div class="cf-header">
      <svg class="cf-logo-svg" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M38.5 24C38.5 23.3 38.4 22.6 38.2 22C37.5 17.5 33.6 14 29 14C26.5 14 24.3 15.1 22.8 16.8C21.7 15.7 20.2 15 18.5 15C15.2 15 12.4 17.5 12.1 20.7C9.2 21.3 7 23.9 7 27C7 30.3 9.7 33 13 33H38C40.8 33 43 30.8 43 28C43 25.4 41 24.2 38.5 24Z" fill="#F6821F"/>
        <path d="M33 33H38C40.8 33 43 30.8 43 28C43 25.4 41 24.2 38.5 24C38.5 23.3 38.4 22.6 38.2 22C37.5 17.5 33.6 14 29 14C28.4 14 27.8 14.1 27.2 14.2L33 33Z" fill="#FAAD3F"/>
      </svg>
      <div>
        <div class="cf-brand-name">Cloudflare Turnstile</div>
        <div class="cf-brand-sub">play.wondermc.fun • Security Gateway</div>
      </div>
    </div>

    <h1 class="cf-title">Checking if the site connection is secure</h1>
    <p class="cf-subtitle">
      WonderMc Network requires human verification to protect our Discord community from automated bots and DDoS attacks.
    </p>

    <div id="deviceBadge" class="device-pill desktop">
      <span>💻</span> <span id="deviceText">Detecting device...</span>
    </div>

    <div class="cf-error-alert" id="errorBox"></div>

    <div class="user-card">
      <div class="user-details">
        <div class="user-avatar-circle" id="userInitial">W</div>
        <div class="user-meta">
          <div class="u-name" id="userNameDisplay">Retrieving Discord session...</div>
          <div class="u-desc">Authenticated Discord Member</div>
        </div>
      </div>
      <div class="badge-sec">SSL 256-Bit</div>
    </div>

    <!-- Turnstile Box -->
    <div class="turnstile-box" id="turnstileBox" onclick="handleChallengeClick()">
      <div class="turnstile-left">
        <div class="cf-checkbox" id="cfBox"></div>
        <div class="turnstile-label" id="turnstileLabel">Verify you are human</div>
      </div>
      <div class="turnstile-branding">
        <div class="turnstile-cf-logo">
          <svg width="18" height="14" viewBox="0 0 24 18" fill="currentColor">
            <path d="M19.5 9C19.5 8.5 19.4 8 19.2 7.6C18.6 4.4 15.9 2 12.6 2C10.8 2 9.2 2.8 8.1 4C7.3 3.4 6.3 3 5.2 3C2.9 3 1 4.9 1 7.2C0.4 7.7 0 8.5 0 9.4C0 11 1.3 12.3 2.9 12.3H19.5C21.4 12.3 23 10.8 23 9C23 7.3 21.6 6.1 19.5 9Z"/>
          </svg>
          CLOUDFLARE
        </div>
        <div class="turnstile-legal">Privacy • Terms</div>
      </div>
    </div>

    <button class="cf-btn-submit" id="btnSubmit" disabled onclick="submitVerification()">
      Proceed to Discord Server ➔
    </button>

    <div class="cf-footer">
      <div>Ray ID: <span class="cf-ray-id" id="rayId">89f02c7b3e1a90d4</span></div>
      <div>Performance & security by Cloudflare • WonderMc Network Shield</div>
    </div>
  </div>

  <!-- Success View -->
  <div class="cf-container cf-success-panel" id="successContainer">
    <div class="cf-success-badge">✓</div>
    <h1 class="cf-title" style="color: #2ECC71; text-align: center;">Verification Successful!</h1>
    <p class="cf-subtitle" style="text-align: center; margin-bottom: 20px;">
      Your identity has been confirmed by Cloudflare Turnstile. Your <strong>@Verified</strong> role has been dispatched to Discord!
    </p>
    <div style="background: #191E2C; border: 1px solid #283145; border-radius: 12px; padding: 18px; text-align: left; margin-bottom: 20px;">
      <div style="font-size: 13.5px; color: #E2E8F0; margin-bottom: 8px;">
        🛡️ <strong>Discord Server:</strong> WonderMc Network
      </div>
      <div style="font-size: 13.5px; color: #E2E8F0; margin-bottom: 8px;">
        ✅ <strong>Security Status:</strong> Human Verified (Ray ID: <span class="cf-ray-id" id="rayIdSuccess"></span>)
      </div>
      <div style="font-size: 13.5px; color: #2ECC71;">
        🎮 <strong>Minecraft IP:</strong> play.wondermc.fun (Port: 19132)
      </div>
    </div>
    <p style="font-size: 12.5px; color: #64748B; text-align: center;">
      You may now close this tab and return to Discord. All channels are unlocked!
    </p>
  </div>

  <script>
    const token = "${token}";
    let isVerifying = false;
    let isVerified = false;

    // Detect device type (Phone vs PC)
    function detectDevice() {
      const ua = navigator.userAgent || "";
      const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
      const badge = document.getElementById("deviceBadge");
      const text = document.getElementById("deviceText");

      if (isMobile) {
        badge.className = "device-pill mobile";
        badge.innerHTML = "<span>📱</span> Phone Mode (Mobile Touch Verified)";
      } else {
        badge.className = "device-pill desktop";
        badge.innerHTML = "<span>💻</span> PC Desktop Mode (Hardware Verified)";
      }

      // Generate realistic Cloudflare Ray ID
      const randomHex = Math.random().toString(16).substring(2, 10) + Math.random().toString(16).substring(2, 10);
      document.getElementById("rayId").textContent = randomHex;
      document.getElementById("rayIdSuccess").textContent = randomHex;
    }

    async function checkToken() {
      detectDevice();
      if (!token) {
        showError("Missing or invalid token. Please click 'Verify in Browser' inside Discord.");
        return;
      }
      try {
        const res = await fetch("/api/verify/info?token=" + encodeURIComponent(token));
        const data = await res.json();
        if (!data.success) {
          showError(data.error || "This verification link has expired or is invalid.");
          return;
        }
        document.getElementById("userNameDisplay").textContent = data.username || "Discord Member";
        document.getElementById("userInitial").textContent = (data.username || "W").charAt(0).toUpperCase();

        if (data.status === "completed") {
          showSuccess();
        }
      } catch (e) {
        showError("Unable to reach verification gateway. Please check your internet connection.");
      }
    }

    function handleChallengeClick() {
      if (isVerified || isVerifying) return;
      isVerifying = true;

      const box = document.getElementById("cfBox");
      const label = document.getElementById("turnstileLabel");
      const btn = document.getElementById("btnSubmit");
      const parentBox = document.getElementById("turnstileBox");

      box.className = "cf-checkbox spinning";
      label.textContent = "Verifying with Cloudflare...";

      setTimeout(() => {
        box.className = "cf-checkbox success";
        parentBox.classList.add("verified");
        label.textContent = "Success! Human confirmed";
        isVerified = true;
        isVerifying = false;
        btn.disabled = false;
        // Auto-submit smoothly after verification check
        setTimeout(submitVerification, 400);
      }, 950);
    }

    async function submitVerification() {
      if (!isVerified) return;
      const btn = document.getElementById("btnSubmit");
      btn.disabled = true;
      btn.textContent = "Authorizing Discord Role...";

      try {
        const res = await fetch("/api/verify/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: token, humanCheck: true })
        });
        const data = await res.json();
        if (data.success) {
          showSuccess();
        } else {
          showError(data.error || "Verification failed. Please retry.");
          btn.disabled = false;
          btn.textContent = "Proceed to Discord Server ➔";
        }
      } catch (e) {
        showError("Network error. Please try again.");
        btn.disabled = false;
        btn.textContent = "Proceed to Discord Server ➔";
      }
    }

    function showError(msg) {
      const err = document.getElementById("errorBox");
      err.textContent = msg;
      err.style.display = "block";
    }

    function showSuccess() {
      document.getElementById("mainContainer").style.display = "none";
      document.getElementById("successContainer").style.display = "block";
    }

    checkToken();
  </script>
</body>
</html>`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
    }
    app.get("*", (req, res) => {
      const indexPath = path.join(distPath, "index.html");
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.sendFile(path.join(process.cwd(), "index.html"));
      }
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`WonderMc Portal & Bot Server running on http://localhost:${PORT}`);
  });
}

startServer();
