import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";
import { checkSchema, ConfigError, isRecord, kebabCase, readJson, readText, repoRoot } from "./lib/config.mjs";
import pluginSchema from "../schemas/plugin.schema.json" with { type: "json" };

const claudeManifest = ".claude-plugin/plugin.json";
const antigravityManifest = ".antigravity-plugin/plugin.json";
const marketplaceFile = ".claude-plugin/marketplace.json";
const semver = /^\d+\.\d+\.\d+(?:-[\da-z-]+(?:\.[\da-z-]+)*)?(?:\+[\da-z-]+(?:\.[\da-z-]+)*)?$/i;
const skillFields = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);

function nonempty(value) {
  return typeof value === "string" && Boolean(value.trim());
}

export function validateManifests(root = repoRoot) {
  const portable = readJson(root, "plugin.json");
  checkSchema(pluginSchema, portable, "plugin.json");
  if (!kebabCase.test(portable.name) || !semver.test(portable.version ?? "") ||
      !nonempty(portable.description)) {
    throw new ConfigError("plugin.json needs a kebab-case name, a semantic version, and a description.");
  }
  for (const name of [claudeManifest, antigravityManifest]) {
    const manifest = readJson(root, name);
    if (!isRecord(manifest)) throw new ConfigError(name + " must be a JSON object.");
    for (const field of ["name", "version", "description"]) {
      if (manifest[field] !== portable[field]) {
        throw new ConfigError(name + " field " + field + " must match plugin.json.");
      }
    }
  }
  const marketplace = readJson(root, marketplaceFile);
  if (!isRecord(marketplace) || typeof marketplace.name !== "string" ||
      !kebabCase.test(marketplace.name) || !nonempty(marketplace.owner?.name) ||
      !Array.isArray(marketplace.plugins) || marketplace.plugins.length !== 1) {
    throw new ConfigError(marketplaceFile + " needs a kebab-case name, an owner, and one plugin entry.");
  }
  const [entry] = marketplace.plugins;
  if (entry?.source !== "./" || entry.name !== portable.name ||
      entry.description !== portable.description) {
    throw new ConfigError(marketplaceFile + " must point to ./ and match the plugin name and description.");
  }
  if (!nonempty(entry.category) || !nonempty(entry.policy?.installation) ||
      !nonempty(entry.policy?.authentication)) {
    throw new ConfigError(marketplaceFile + " needs an OpenAI marketplace category and install and authentication policies.");
  }
}

export function validateSkills(root = repoRoot) {
  let directories;
  try {
    directories = readdirSync(join(root, "skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory());
  } catch (error) {
    throw new ConfigError("skills/ could not be read (" + error.code + ").");
  }
  if (!directories.length) throw new ConfigError("skills/ needs at least one skill directory.");

  for (const { name } of directories) {
    const skillPath = "skills/" + name + "/SKILL.md";
    const text = readText(root, skillPath);
    const frontmatter = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
    if (!frontmatter || !text.slice(frontmatter[0].length).trim()) {
      throw new ConfigError(skillPath + " needs YAML frontmatter and Markdown instructions.");
    }
    let skill;
    try {
      skill = parse(frontmatter[1]);
    } catch {
      throw new ConfigError(skillPath + " contains invalid YAML frontmatter.");
    }
    if (!isRecord(skill) || skill.name !== name || !kebabCase.test(name) || name.length > 64 ||
        !nonempty(skill.description) || skill.description.length > 1024) {
      throw new ConfigError(skillPath + " needs a kebab-case name matching its directory and a description of 1–1024 characters.");
    }
    if (Object.keys(skill).some((field) => !skillFields.has(field))) {
      throw new ConfigError(skillPath + " contains unsupported frontmatter fields. Put custom fields under metadata.");
    }
    if (Object.hasOwn(skill, "compatibility") &&
        (!nonempty(skill.compatibility) || skill.compatibility.length > 500)) {
      throw new ConfigError(skillPath + " compatibility must be a string of 1–500 characters.");
    }
    if (Object.hasOwn(skill, "metadata") &&
        (!isRecord(skill.metadata) || Object.values(skill.metadata).some((value) => typeof value !== "string"))) {
      throw new ConfigError(skillPath + " metadata must be a map of string values.");
    }
    for (const field of ["license", "allowed-tools"]) {
      if (Object.hasOwn(skill, field) && !nonempty(skill[field])) {
        throw new ConfigError(skillPath + " " + field + " must be a nonempty string.");
      }
    }
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    validateManifests();
    validateSkills();
    console.log("Plugin manifests, marketplace, and skills are valid.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
