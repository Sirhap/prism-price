#!/usr/bin/env node
import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

const root = path.resolve(import.meta.dirname, "..");
const directory = path.resolve(process.argv[3] || "output/classification-review");
const historyFile = path.resolve(process.argv[4] || "output/local-data/production-complete.sqlite");
const fields = ["brandGroup", "attrType", "attrPlan", "attrDuration", "attrWarranty", "attrSms", "attrRegion"];
const digest = value => createHash("sha256").update(value).digest("hex").slice(0, 24);
const normalize = value => value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const familyOf = row => normalize(row.raw_name).replace(/\d+(?:\.\d+)?/g, "#");
const jsonLines = content => content.toString().trimEnd().split("\n").map(line => JSON.parse(line));
const jsonFile = (name, value) => writeFile(path.join(directory, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
const tsv = value => String(value ?? "").replace(/[\t\r\n]+/g, " ");
const rowsFile = (name, rows) => writeFile(path.join(directory, name), rows.map(row => row.map(tsv).join("\t")).join("\n") + "\n", { mode: 0o600 });

function sample(rows, count) {
  const buckets = new Map();
  for (const row of rows) {
    const stratum = row.platform + "/" + row.brand_group;
    if (!buckets.has(stratum)) buckets.set(stratum, []);
    buckets.get(stratum).push(row);
  }
  const groups = [...buckets].sort(([a], [b]) => a.localeCompare(b));
  if (groups.length > count || rows.length < count) throw new Error("计分集容量不足");
  for (const [, bucket] of groups) {
    bucket.sort((a, b) => digest("parity-review-20261122:"+a.id).localeCompare(digest("parity-review-20261122:"+b.id)));
  }
  const limits = groups.map(([, bucket]) => Math.min(3,bucket.length));
  for (let slot = limits.reduce((sum, size) => sum + size, 0); slot < count; slot++) {
    let best = -1;
    for (let i = 0; i < groups.length; i++) {
      const size = groups[i][1].length;
      if (limits[i] >= size) continue;
      if (best < 0 || size / (limits[i] + 1) > groups[best][1].length / (limits[best] + 1)) best = i;
    }
    limits[best]++;
  }
  return groups.flatMap(([stratum, bucket], i) => bucket.slice(0, limits[i]).map(row => ({
    ...row, stratum, weight: bucket.length / limits[i],
  }))).sort((a, b) => digest("blind:"+a.id).localeCompare(digest("blind:"+b.id)));
}

async function prepare(rows, priorPaths) {
  const catalogAudit = process.env.REVIEW_SAMPLE_SCOPE === "catalog";
  if (priorPaths.length) {
    const prior = await Promise.all(priorPaths.map(async previous => JSON.parse(await readFile(path.resolve(previous), "utf8"))));
    const holdout = new Set(prior.flatMap(run => [...run.evaluation.map(item=>item.id), ...run.challenge]));
    if (catalogAudit) {
      rows = rows.filter(row => !holdout.has(row.id));
    } else {
      const used = new Set(rows.filter(row=>holdout.has(row.id)).map(familyOf));
      rows = rows.filter(row=>!used.has(familyOf(row)));
    }
  }
  const evaluation = sample(rows, 600);
  const seen = new Set(evaluation.map(familyOf));
  const candidates = rows.filter(row => /^(?:其它|中转|工具教程|接码服务|虚拟卡)$/.test(row.brand_group) ||
    /适用|附带|附赠|赠送|不支持|不含|组合|双会员|任选|[x×]20|质保|注册ip|xiaomi/i.test(row.raw_name));
  const challenge = [];
  for (const row of candidates.sort((a, b) => digest(a.id + "challenge").localeCompare(digest(b.id + "challenge")))) {
    if (seen.has(familyOf(row))) continue;
    seen.add(familyOf(row));
    challenge.push(row);
    if (challenge.length === 240) break;
  }
  if (challenge.length !== 240) throw new Error("疑难样本不足");
  await jsonFile("sample.json", { scope: catalogAudit ? "catalog-unreviewed-offers" : "unseen-title-families", populationRows: rows.length, evaluation: evaluation.map(({id, stratum, weight}) => ({id, stratum, weight})), challenge: challenge.map(row => row.id) });
  const blindRows = list => [["序号", "报价ID", "平台", "商品标题", "店铺原分类"],
    ...list.map((row, index) => [index + 1, row.id, row.platform, row.raw_name, row.shop_category])];
  await rowsFile("blind-evaluation.tsv", blindRows(evaluation));
  await rowsFile("blind-challenge.tsv", blindRows(challenge));
  console.log(JSON.stringify({ scope: catalogAudit ? "catalog-unreviewed-offers" : "unseen-title-families", populationRows: rows.length, evaluation: evaluation.length, challenge: challenge.length, strata: new Set(evaluation.map(row => row.stratum)).size }));
}

async function loadClassifier(source) {
  const result = await build({ entryPoints:[path.join(source, "src/collector/etl/cleaner.ts")],
    bundle:true, format:"esm", platform:"node", target:"node22", write:false });
  return import("data:text/javascript;base64," + Buffer.from(result.outputFiles[0].text).toString("base64"));
}

function normalizeRow(classifier, row, description) {
  const ignored = classifier.isNonSalePlaceholderItem(row.raw_name, row.shop_category, row.price);
  const item = { itemKey:row.id, rawName:row.raw_name, shopCategory:row.shop_category, price:row.price,
    stockCount:null, stockStatus:"sufficient", itemUrl:"" };
  return { ignored, ...classifier.normalizeOffer(row.shop_id,item,"",description) };
}

async function evaluate(rows, meta) {
  const temporary = await mkdtemp(path.join(tmpdir(), "parity-baseline-"));
  try {
    const archive = execFileSync("git", ["archive", meta.release, "src"], { cwd:root });
    execFileSync("tar", ["-xf", "-", "-C", temporary], { input:archive });
    const [baseline, candidate] = await Promise.all([loadClassifier(temporary), loadClassifier(root)]);
    const comparator = process.env.REVIEW_COMPARATOR ? await import(pathToFileURL(path.resolve(process.env.REVIEW_COMPARATOR))) : undefined;
    const details = process.env.REVIEW_DETAILS
      ? new Map(JSON.parse(await readFile(path.resolve(process.env.REVIEW_DETAILS), "utf8"))
        .filter(row => typeof row.description === "string" && row.description.trim()).map(row => [row.id, row.description]))
      : new Map();
    const samples = JSON.parse(await readFile(path.join(directory,"sample.json"),"utf8"));
    const labels = JSON.parse(await readFile(path.join(directory,"labels.json"),"utf8"));
    const sampleById = new Map(samples.evaluation.map(item=>[item.id,item]));
    const challengeIds = new Set(samples.challenge);
    if (new Set(labels.map(label=>label.id)).size !== labels.length || labels.length !== sampleById.size ||
        labels.some(label=>!sampleById.has(label.id) || label.expected.length !== fields.length)) throw new Error("计分集标注缺失或不匹配");
    const labelById = new Map(labels.map(label => [label.id,label.expected]));
    const pairs = [];
    const challenges = [];
    const changes = [];
    const oldToNew = new Map();
    const newToOld = new Map();
    const oldMinimum = new Map();
    const newMinimum = new Map();
    const add = (mapping, from, to) => {
      if (!mapping.has(from)) mapping.set(from, new Set());
      mapping.get(from).add(to);
    };
    const putMinimum = (mapping, key, price) => mapping.set(key,Math.min(mapping.get(key) ?? Infinity, price));

    for(const row of rows){
      const description = details.get(row.id);
      const old = normalizeRow(baseline,row);
      const titleOnly = normalizeRow(candidate,row);
      const next = description ? normalizeRow(candidate,row,description) : titleOnly;
      const publishedKey = row.group_key;
      const nextKey = digest(next.groupKey);
      if (!next.ignored) {
        add(oldToNew,publishedKey,nextKey); add(newToOld,nextKey,publishedKey);
        putMinimum(newMinimum,nextKey,next.price);
      }
      putMinimum(oldMinimum,publishedKey,row.price);
      const before = fields.map(key=>old[key]);
      const after = fields.map(key=>next[key]);
      const evidence = (labelById.has(row.id) || challengeIds.has(row.id) || before.some((value,i)=>value!==after[i]))
        ? candidate.classifyProduct(row.raw_name,row.shop_category,description) : null;
      if (before.some((value,i)=>value!==after[i]) || publishedKey!==nextKey || old.ignored!==next.ignored) {
        changes.push([row.id,row.platform,row.raw_name,row.shop_category,...before,...after,publishedKey,next.ignored?"":nextKey,
          evidence?.ruleId,evidence?.evidence,evidence?.reasons.join(",")]);
      }
      if(challengeIds.has(row.id)) challenges.push([row.id,row.platform,row.raw_name,row.shop_category,...before,...after,
        evidence.ruleId,evidence.evidence,evidence.reasons.join(",")]);
      if(labelById.has(row.id)) {
        const prior = comparator ? normalizeRow(comparator,row) : undefined;
        pairs.push({ row,before,after,expected:labelById.get(row.id),weight:sampleById.get(row.id).weight,
          evidence,oldIgnored:old.ignored,newIgnored:next.ignored,
          ...(details.size ? { titleOnly:fields.map(key=>titleOnly[key]),titleOnlyIgnored:titleOnly.ignored } : {}),
          ...(prior ? { prior:fields.map(key=>prior[key]), priorIgnored:prior.ignored } : {}) });
      }
    }
    await rowsFile("diff.tsv",[["报价ID","平台","标题","店铺分类",...fields.map(key=>"旧_"+key),...fields.map(key=>"新_"+key),
      "线上旧组","本地新组","规则","证据来源","歧义原因"],...changes]);
    await rowsFile("challenge-results.tsv",[["报价ID","平台","标题","店铺分类",...fields.map(key=>"旧_"+key),...fields.map(key=>"新_"+key),
      "规则","证据来源","歧义原因"],...challenges]);
    await rowsFile("group-changes.tsv",[["旧组","新组","拆分","合并","旧最低价","新最低价"],
      ...[...oldMinimum].flatMap(([key,price])=>{
        const targets=oldToNew.get(key);
        if (!targets) return [[key,"",false,false,price,""]];
        return [...targets].filter(to=>key!==to || targets.size>1 || newToOld.get(to).size>1 || price!==newMinimum.get(to))
          .map(to=>[key,to,targets.size>1,newToOld.get(to).size>1,price,newMinimum.get(to)]);
      })]);
    const labelHeader = ["报价ID","平台","标题","店铺分类",...fields.map(key=>"标注_"+key),
      ...fields.map(key=>"旧_"+key),...(comparator ? fields.map(key=>"上一版_"+key) : []),
      ...fields.map(key=>"新_"+key),"证据来源","歧义原因","抽样权重"];
    const labelRow = ({row,expected,before,prior,after,evidence,weight}) => [row.id,row.platform,row.raw_name,row.shop_category,
      ...expected.map(value=>value===null?"待复核":value),...before,...(prior ?? []),...after,evidence.evidence,evidence.reasons.join(","),weight];
    const needsReview = ({expected,before,after}) => expected.some((value,i)=>value===null || value!==before[i] || value!==after[i]);
    await rowsFile("all-labels.tsv",[labelHeader,...pairs.map(labelRow)]);
    await rowsFile("label-review.tsv",[labelHeader,...pairs.filter(needsReview).map(labelRow)]);
    await rowsFile("brand-regressions.tsv",[labelHeader,...pairs.filter(({expected,before,after})=>
      expected[0]!==null && expected[0]===before[0] && expected[0]!==after[0],
    ).map(labelRow)]);
    const disagreements = pairs.filter(({expected,after})=>expected[0]!==after[0]);
    disagreements.sort((left,right)=>right.weight-left.weight || left.row.id.localeCompare(right.row.id));
    await rowsFile("brand-review-priority.tsv",[labelHeader,...disagreements.map(labelRow)]);
    const confusion = new Map();
    for (const {expected,before,after} of pairs) {
      if (expected[0]===null) continue;
      for (const [side,label] of [["旧",before[0]],["新",after[0]]]) {
        if (label===expected[0]) continue;
        const key=JSON.stringify([side,expected[0],label]);
        confusion.set(key,(confusion.get(key)??0)+1);
      }
    }
    await rowsFile("brand-confusion.tsv",[["版本","标注主分类","预测主分类","样本数"],
      ...[...confusion].sort((a,b)=>b[1]-a[1]).map(([key,count])=>[...JSON.parse(key),count])]);
    const byName = [...new Map(pairs.map(pair=>[normalize(pair.row.raw_name),pair])).values()];
    const strata = Object.fromEntries([...new Set(pairs.map(pair=>pair.row.platform))].sort().map(platform=>[platform,
      score(pairs.filter(pair=>pair.row.platform===platform),0)]));
    const historical = await checkHistory(baseline,candidate);
    const report = { snapshot:meta, sampleScope:samples.scope ?? "unseen-title-families", samplePopulationRows:samples.populationRows, publicDescriptions:details.size, currentRows:rows.length, changes:changes.length, historical,
      splitGroups:[...oldToNew.values()].filter(group=>group.size>1).length,
      mergedGroups:[...newToOld.values()].filter(group=>group.size>1).length,
      weightedBrand:score(pairs,0,true), deduplicatedTitleBrand:score(byName,0), strata,
      brandOther: {
        labeled:pairs.filter(row=>row.expected[0]==="其它").length,
        before:pairs.filter(row=>row.before[0]==="其它").length,
        after:pairs.filter(row=>row.after[0]==="其它").length,
      },
      fields:Object.fromEntries(fields.map((name,i)=>[name,score(pairs,i)])) };
    await jsonFile("metrics.json",report);
    console.log(JSON.stringify(report,null,2));
  } finally { await rm(temporary,{recursive:true,force:true}); }
}

function score(rows, index, weighted = false) {
  const eligible = rows.filter(row=>row.expected[index]!==null);
  const sum = (list, predicate) => list.reduce((total,row)=>total+(predicate(row)?(weighted?row.weight:1):0),0);
  const denominator=sum(eligible,()=>true);
  const expectedNonEmpty=sum(eligible,row=>!!row.expected[index]);
  const rounded = (count,base) => base ? Math.round(10000*count/base)/100 : null;
  const result = {samples:rows.length,labeled:eligible.length,undetermined:rows.length-eligible.length,expectedNonEmpty};
  const ignoredKeys = { before:"oldIgnored", after:"newIgnored", prior:"priorIgnored", titleOnly:"titleOnlyIgnored" };
  const sides = ["before", ...(rows[0]?.prior ? ["prior"] : []), ...(rows[0]?.titleOnly ? ["titleOnly"] : []), "after"];
  for(const side of sides){
    const ignored = ignoredKeys[side];
    const predicted = eligible.filter(row=>!row[ignored] && !!row[side][index]);
    const correct = row=>!row[ignored] && row.expected[index]===row[side][index];
    result[side]={
      correct:sum(eligible,correct),
      accuracy:rounded(sum(eligible,correct),denominator),
      coverage:rounded(sum(predicted,()=>true),denominator),
      precisionWhenAssigned:rounded(sum(predicted,correct),sum(predicted,()=>true)),
      recallOfKnown:rounded(sum(predicted,correct),expectedNonEmpty),
    };
  }
  return result;
}

async function checkHistory(baseline,candidate) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(historyFile,{readOnly:true});
  try {
    let count=0, changes=0, exclusions=0;
    for(const row of db.prepare("SELECT id,shop_id,raw_name,shop_category,price FROM offers").iterate()){
      count++;
      const left=normalizeRow(baseline,row),right=normalizeRow(candidate,row);
      if(fields.some(key=>left[key]!==right[key])) changes++;
      if(left.ignored!==right.ignored) exclusions++;
    }
    return {rows:count,labelChanges:changes,changedExclusions:exclusions};
  } finally { db.close(); }
}

const [meta,...rows] = jsonLines(gunzipSync(await readFile(path.join(directory,"current.jsonl.gz"))));
if (meta.count!==rows.length || !/^[0-9a-f]{40}$/.test(meta.release)) throw new Error("目录快照不完整或版本无效");
if (process.argv[2] === "prepare") await prepare(rows,process.argv.slice(4));
else if (process.argv[2] === "evaluate") await evaluate(rows,meta);
else throw new Error("用法: node scripts/review-classification.mjs prepare [评测目录] [排除的 sample.json ...] 或 evaluate [评测目录] [历史SQLite]");
