# Stork-bot 验证机器人

这是一个用于验证 Stork Oracle 签名价格数据的机器人。它会定期从 API 获取签名价格数据，并验证其有效性。


## 安装

1. 克隆此仓库到本地：

```sh
git clone https://github.com/varown/stork-bot.git
cd stork-bot
```
2. 安装依赖：
```sh
npm install
```
## 配置
- 填写 accounts.js 文件：

```sh
export const accounts = [
  { username: "email1", password: "pass1" },
  { username: "email2", password: "pass2" },
];
```


## 启动
```sh
node index.js
```


## ⚠️ 注意

此机器人仅用于教育目的。使用风险自负，并确保遵守 stork 的服务条款
