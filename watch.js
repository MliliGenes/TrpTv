#!/usr/bin/env node
/**
 * Interactive CLI: Fetch 123Movies stream URL and play
 * Prompts user for ID, season, episode, and choice of browser/mpv
 */

import axios from "axios";
import * as cheerio from "cheerio";
import inquirer from "inquirer";
import open from "open";
import { spawn } from "child_process";

async function promptUser() {
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "idd",
      message: "Enter the IDD:",
      validate: input => input ? true : "IDD cannot be empty",
    },
    {
      type: "input",
      name: "season",
      message: "Enter the season number:",
      validate: input => input ? true : "Season cannot be empty",
    },
    {
      type: "input",
      name: "episode",
      message: "Enter the episode number:",
      validate: input => input ? true : "Episode cannot be empty",
    },
    {
      type: "list",
      name: "playOption",
      message: "Choose how to play the stream:",
      choices: ["Print URL only", "Open in browser", "Play in mpv"],
    },
  ]);

  return answers;
}

async function getStreamUrl(idd, season, episode) {
  const baseUrl = `https://stevenuniverse.best/video-player/?idd=${idd}&season=${season}&episode=${episode}`;
  const referer = "https://stevenuniverse.best";

  // Fetch video page
  const { data: html } = await axios.get(baseUrl, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  // Extract watch URL
  const $ = cheerio.load(html);
  let watchUrl = null;
  $("iframe, script, a").each((_, el) => {
    const attr = $(el).attr("src") || $(el).attr("href") || $(el).text();
    if (attr && attr.includes("123moviespremium.net/watch/")) {
      watchUrl = attr.replace(/&amp;/g, "&");
      return false;
    }
  });

  if (!watchUrl) throw new Error("No watch URL found");

  // Fetch playlist or direct stream
  const resp = await axios.get(watchUrl, {
    headers: { "User-Agent": "Mozilla/5.0", Referer: referer },
    responseType: "arraybuffer",
  });

  const contentType = resp.headers["content-type"] || "";

  if (contentType.includes("mpegurl")) {
    const playlist = resp.data.toString("utf8");
    const finalUrl = playlist.split("\n").find(line => line && !line.startsWith("#"));
    return finalUrl || watchUrl;
  } else {
    return watchUrl;
  }
}

async function main() {
  try {
    const { idd, season, episode, playOption } = await promptUser();
    const streamUrl = await getStreamUrl(idd, season, episode);

    console.log("\n[*] Stream URL:", streamUrl);

    if (playOption === "Open in browser") {
      await open(streamUrl);
    } else if (playOption === "Play in mpv") {
      const mpv = spawn("mpv", [streamUrl], { stdio: "inherit" });
      mpv.on("exit", code => process.exit(code));
    }
  } catch (err) {
    console.error("[!] Error:", err.message);
    process.exit(1);
  }
}

main();

