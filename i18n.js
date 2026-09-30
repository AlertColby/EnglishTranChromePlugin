// i18n.js —— 极简文案工具
// 当前只内置中文，保留接口以便后续扩展

const dict = {
  menu_selection: "翻译选中的英文 “%s”",
  menu_page: "翻译当前页面正文为中文"
};

export function t(key, fallback) {
  return dict[key] || fallback || key;
}