# Stork-bot 验证机器人

这是一个用于验证 Stork Oracle 签名价格数据的机器人。它会定期从 API 获取签名价格数据，并验证其有效性。


## 安装

1. 克隆此仓库到本地：

```sh
git clone <repository-url>
cd stork-bot
```
2. 安装依赖：
```sh
npm install
```
## 配置
- 创建并填写 tokens.json 文件：

- 如果 tokens.json 文件不存在，程序会自动创建一个模板文件。你需要从 Stork Verify 应用的 localStorage 中复制令牌并粘贴到 tokens.json 文件中。
```sh
{
  "accessToken": "<你的访问令牌>",
  "idToken": "<你的ID令牌>",
  "refreshToken": "<你的刷新令牌>",
  "isAuthenticated": true,
  "isVerifying": false
}
```
<img width="316" alt="image" src="https://github.com/user-attachments/assets/6b7753bc-84ce-4506-92fa-cd6517f3620b" />


## 启动
```sh
node index.js
```


## ⚠️ 注意

此机器人仅用于教育目的。使用风险自负，并确保遵守 stork 的服务条款
