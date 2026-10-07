// Deterministic checks for new reader summaries only. This is not the draft fact gate.
const companies: Array<[string, RegExp]> = [
  ['OpenAI', /\bopen\s?ai\b/iu], ['Anthropic', /\banthropic\b|安索匹克/iu],
  ['Google', /\bgoogle\b|谷歌/iu], ['DeepMind', /\bdeepmind\b/iu],
  ['Microsoft', /\bmicrosoft\b|微软/iu], ['NVIDIA', /\bnvidia\b|英伟达/iu],
  ['Apple', /\bapple\b|苹果公司/iu], ['Meta', /\bmeta\b/iu],
  ['Amazon', /\bamazon\b|亚马逊/iu], ['阿里巴巴', /\balibaba\b|阿里(?:巴巴|云)/iu],
  ['百度', /\bbaidu\b|百度/iu], ['腾讯', /\btencent\b|腾讯/iu],
  ['字节跳动', /\bbytedance\b|字节跳动/iu], ['智谱', /\bzhipu\b|\bz\.ai\b|智谱/iu],
  ['DeepSeek', /\bdeepseek\b|深度求索/iu], ['Mistral', /\bmistral\b/iu],
  ['月之暗面', /\bmoonshot\b|月之暗面/iu], ['Hugging Face', /\bhugging\s?face\b/iu],
];

export function assertBriefingGrounded(sourceTitle: string, sourceText: string, title: string, output: string) {
  const evidence = `${sourceTitle}\n${sourceText}`;
  const invented = companies.filter(([, pattern]) => pattern.test(output) && !pattern.test(evidence)).map(([name]) => name);
  if (invented.length) throw new Error(`中文速读新增了来源未支持的主体：${invented.join('、')}`);
  const guide = /\bhow\s+to\b|\b(?:guide|tutorial|review|walkthrough)\b|教程|指南|评测|实测/iu.test(sourceTitle);
  const release = /\b(?:launch(?:es|ed)?|releas(?:e[sd]?|ing)|introduc(?:es|ed|ing)|announc(?:es|ed|ing))\b|发布|推出|上线|开放/iu.test(sourceTitle);
  const launchTitle = /发布|推出|上线|开放|开源/u.test(title) && !/教程|指南|评测|实测|如何|解读|方法/u.test(title);
  if (guide && !release && launchTitle) throw new Error('原文是教程或测评，中文标题不能改成产品发布');
}
