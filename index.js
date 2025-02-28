const fs = require("fs");
const axios = require("axios");
const path = require("path");

const config = {
  baseURL: "https://app-api.jp.stork-oracle.network/v1",
  authURL: "https://api.jp.stork-oracle.network/auth",
  tokenPath: path.join(__dirname, "tokens.json"),
  intervalSeconds: 60, // Polling interval in seconds
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36",
  origin: "chrome-extension://knnliglhgkmlblppdejchidfihjnockl",
};

function getTimestamp() {
  const now = new Date();
  return now.toISOString().replace("T", " ").substr(0, 19);
}

function getFormattedDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function log(message, type = "INFO") {
  console.log(`[${getFormattedDate()}] [${type}] ${message}`);
}

async function getTokens() {
  try {
    log(`读取令牌文件 ${config.tokenPath}...`);

    if (!fs.existsSync(config.tokenPath)) {
      throw new Error(`令牌文件未找到: ${config.tokenPath}`);
    }

    const tokensData = await fs.promises.readFile(config.tokenPath, "utf8");
    const tokens = JSON.parse(tokensData);

    if (!tokens.accessToken || tokens.accessToken.length < 20) {
      throw new Error("无效的访问令牌（太短或为空）");
    }

    log(`成功读取访问令牌: ${tokens.accessToken.substring(0, 10)}...`);
    return tokens;
  } catch (error) {
    log(`读取令牌时出错: ${error.message}`, "ERROR");
    throw error;
  }
}
async function saveTokens(tokens) {
  try {
    await fs.promises.writeFile(
      config.tokenPath,
      JSON.stringify(tokens, null, 2),
      "utf8"
    );
    log("令牌保存成功");
    return true;
  } catch (error) {
    log(`保存令牌时出错: ${error.message}`, "ERROR");
    return false;
  }
}

async function refreshTokens(refreshToken) {
  try {
    log("正在刷新访问令牌...");

    const response = await axios({
      method: "POST",
      url: `${config.authURL}/refresh`,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": config.userAgent,
        "Origin": config.origin,
      },
      data: {
        refresh_token: refreshToken,
      },
    });

    if (
      response.status !== 200 ||
      !response.data ||
      !response.data.access_token
    ) {
      throw new Error(`刷新令牌失败: ${response.status}`);
    }

    const tokens = {
      accessToken: response.data.access_token,
      idToken: response.data.id_token || "",
      refreshToken: response.data.refresh_token || refreshToken,
      isAuthenticated: true,
      isVerifying: false,
    };

    log("令牌刷新成功");
    await saveTokens(tokens);
    return tokens;
  } catch (error) {
    log(`刷新令牌失败: ${error.message}`, "ERROR");
    throw error;
  }
}

async function getSignedPrices(tokens) {
  let currentTokens = tokens;
  let retryCount = 0;
  const maxRetries = 1;

  while (retryCount <= maxRetries) {
    try {
      log("正在获取签名数据...");

      const response = await axios({
        method: "GET",
        url: `${config.baseURL}/stork_signed_prices`,
        headers: {
          "Authorization": `Bearer ${currentTokens.accessToken}`,
          "Content-Type": "application/json",
          "Origin": config.origin,
          "User-Agent": config.userAgent,
          "Accept": "*/*",
          "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "cross-site",
        },
        validateStatus: function (status) {
          return status >= 200 && status < 500;
        },
      });

      if (response.status === 401) {
        if (retryCount < maxRetries && currentTokens.refreshToken) {
          log("访问令牌已过期，尝试刷新...", "WARN");
          currentTokens = await refreshTokens(currentTokens.refreshToken);
          retryCount++;
          continue;
        } else {
          throw new Error("令牌刷新失败或达到最大重试次数");
        }
      }

      if (response.status !== 200) {
        log(`API响应状态: ${response.status}`, "WARN");
        log(`响应内容: ${JSON.stringify(response.data || {})}`, "DEBUG");
        return [];
      }

      if (!response.data || !response.data.data) {
        log(`响应格式不正确: ${JSON.stringify(response.data || {})}`, "WARN");
        return [];
      }

      const dataObj = response.data.data;
      const result = Object.keys(dataObj).map((assetKey) => {
        const assetData = dataObj[assetKey];
        return {
          asset: assetKey,
          msg_hash: assetData.timestamped_signature.msg_hash,
          price: assetData.price,
          timestamp: new Date(
            assetData.timestamped_signature.timestamp / 1000000
          ).toISOString(),
          ...assetData,
        };
      });

      log(`成功获取 ${result.length || 0} 个签名价格`);
      return result;
    } catch (error) {
      if (error.response) {
        const statusCode = error.response.status;
        const errorMessage =
          error.response.data?.message ||
          error.response.data?.error ||
          error.message;

        log(
          `获取签名价格时出错: 状态 ${statusCode}, 信息: ${errorMessage}`,
          "ERROR"
        );

        if (
          statusCode === 401 &&
          retryCount < maxRetries &&
          currentTokens.refreshToken
        ) {
          log("令牌可能已过期，尝试刷新...", "WARN");
          try {
            currentTokens = await refreshTokens(currentTokens.refreshToken);
            retryCount++;
            continue;
          } catch (refreshError) {
            log("令牌刷新失败，请手动更新令牌", "ERROR");
          }
        }
      } else {
        log(`获取签名价格时出错: ${error.message}`, "ERROR");
      }

      throw error;
    }
  }
}
async function sendValidation(tokens, msgHash, isValid) {
  let currentTokens = tokens;
  let retryCount = 0;
  const maxRetries = 1;

  while (retryCount <= maxRetries) {
    try {
      const payload = {
        msg_hash: msgHash,
        valid: isValid,
      };

      log(
        `验证: ${msgHash.substring(0, 10)}... = ${isValid ? "有效" : "无效"}`
      );

      const response = await axios({
        method: "POST",
        url: `${config.baseURL}/stork_signed_prices/validations`,
        headers: {
          "Authorization": `Bearer ${currentTokens.accessToken}`,
          "Content-Type": "application/json",
          "Origin": config.origin,
          "User-Agent": config.userAgent,
          "Accept": "*/*",
          "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "cross-site",
        },
        data: payload,
      });

      log(`✓ 验证成功: ${response.data.message || "状态 " + response.status}`);
      return response.data;
    } catch (error) {
      if (
        error.response &&
        error.response.status === 401 &&
        retryCount < maxRetries &&
        currentTokens.refreshToken
      ) {
        log("验证期间令牌过期，尝试刷新...", "WARN");
        try {
          currentTokens = await refreshTokens(currentTokens.refreshToken);
          retryCount++;
          continue;
        } catch (refreshError) {
          log("令牌刷新失败，请手动更新令牌", "ERROR");
        }
      }

      log(`✗ 验证失败: ${error.response?.status || error.message}`, "ERROR");

      if (error.response?.data) {
        log(`错误响应: ${JSON.stringify(error.response.data)}`, "DEBUG");
      }

      throw error;
    }
  }
}

function validatePrice(priceData) {
  try {
    log(`验证数据: ${priceData.asset || "未知资产"}`);

    if (!priceData.msg_hash || !priceData.price || !priceData.timestamp) {
      log("数据不完整，视为无效", "WARN");
      return false;
    }

    const currentTime = Date.now();
    const dataTime = new Date(priceData.timestamp).getTime();
    const timeDiffMinutes = (currentTime - dataTime) / (1000 * 60);

    if (timeDiffMinutes > 60) {
      log(`数据过旧（${Math.round(timeDiffMinutes)} 分钟前）`, "WARN");
      return false;
    }

    return true;
  } catch (error) {
    log(`验证错误: ${error.message}`, "ERROR");
    return false;
  }
}
async function getUserStats(tokens) {
  let currentTokens = tokens;
  let retryCount = 0;
  const maxRetries = 1;

  while (retryCount <= maxRetries) {
    try {
      log("正在获取用户统计数据...");

      const response = await axios({
        method: "GET",
        url: `${config.baseURL}/me`,
        headers: {
          "Authorization": `Bearer ${currentTokens.accessToken}`,
          "Content-Type": "application/json",
          "Origin": config.origin,
          "User-Agent": config.userAgent,
          "Accept": "*/*",
          "Accept-Language": "en-US,en;q=0.9,id;q=0.8",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Sec-Fetch-Dest": "empty",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Site": "cross-site",
        },
        validateStatus: function (status) {
          return status >= 200 && status < 500;
        },
      });

      if (response.status === 401) {
        if (retryCount < maxRetries && currentTokens.refreshToken) {
          log("访问令牌已过期，尝试刷新...", "WARN");
          currentTokens = await refreshTokens(currentTokens.refreshToken);
          retryCount++;
          continue;
        } else {
          throw new Error("令牌刷新失败或达到最大重试次数");
        }
      }

      if (response.status !== 200) {
        log(`API响应状态: ${response.status}`, "WARN");
        log(`响应内容: ${JSON.stringify(response.data || {})}`, "DEBUG");

        return null;
      }

      if (!response.data || !response.data.data) {
        log(`响应格式不正确: ${JSON.stringify(response.data || {})}`, "WARN");
        return null;
      }

      return response.data.data;
    } catch (error) {
      if (
        error.response &&
        error.response.status === 401 &&
        retryCount < maxRetries &&
        currentTokens.refreshToken
      ) {
        log("获取统计数据期间令牌过期，尝试刷新...", "WARN");
        try {
          currentTokens = await refreshTokens(currentTokens.refreshToken);
          retryCount++;
          continue;
        } catch (refreshError) {
          log("令牌刷新失败，请手动更新令牌", "ERROR");
        }
      } else {
        log(`获取用户统计数据时出错: ${error.message}`, "ERROR");
      }

      throw error;
    }
  }
}

async function runValidationProcess(total) {
  console.log(`total: ${total}`);
  try {
    log("--------- 开始验证过程 ---------");

    const tokens = await getTokens();
    if (!tokens || !tokens.accessToken) {
      throw new Error("空或无效的访问令牌");
    }

    const signedPrices = await getSignedPrices(tokens);
    if (total === 1) {
      const updatedUserData = await getUserStats(tokens);
      displayStats(updatedUserData);
    }
    if (!Array.isArray(signedPrices) || signedPrices.length === 0) {
      log("没有数据需要验证");

      const userData = await getUserStats(tokens);
      displayStats(userData);
      return;
    }

    log(`处理 ${signedPrices.length} 个数据点...`);
    let successCount = 0;
    let failCount = 0;

    for (const price of signedPrices) {
      try {
        const msgHash = price.msg_hash;

        if (!msgHash) {
          log("数据没有 msg_hash，跳过...", "WARN");
          continue;
        }

        const isValid = validatePrice(price);

        await sendValidation(tokens, msgHash, isValid);
        successCount++;

        await new Promise((resolve) => setTimeout(resolve, 500));
      } catch (error) {
        failCount++;
        log(`处理数据时出错: ${error.message}`, "ERROR");
        continue;
      }
    }
  } catch (error) {
    log(`验证过程停止: ${error.message}`, "ERROR");
  }
}

function displayStats(userData) {
  if (!userData || !userData.stats) {
    log("没有可显示的有效统计数据", "WARN");
    return;
  }

  const stats = userData.stats;
  const email = userData.email || "N/A";
  const id = userData.id || "N/A";

  console.log(`时间: ${getTimestamp()}`);
  console.log("---------------------------------------------");
  console.log(`用户: ${email}`);
  console.log(`ID: ${id}`);
  console.log("验证统计数据:");
  console.log(`✓ 有效验证: ${stats.stork_signed_prices_valid_count || 0}`);
  console.log(`✗ 无效验证: ${stats.stork_signed_prices_invalid_count || 0}`);
}

function createTokensFileIfNotExists() {
  if (!fs.existsSync(config.tokenPath)) {
    log(`未找到 tokens.json 文件。在 ${config.tokenPath} 创建模板文件`, "WARN");
    try {
      const tokenTemplate = {
        accessToken: "",
        idToken: "",
        refreshToken: "",
        isAuthenticated: true,
        isVerifying: false,
      };

      fs.writeFileSync(
        config.tokenPath,
        JSON.stringify(tokenTemplate, null, 2),
        "utf8"
      );
      log(`tokens.json 文件已创建。请填写有效的令牌`, "INFO");
      log(
        `提示: 从 Stork Oracle 应用的 localStorage 中复制令牌并粘贴到 tokens.json 文件中`,
        "INFO"
      );
      return false;
    } catch (error) {
      log(`创建令牌文件失败: ${error.message}`, "ERROR");
      return false;
    }
  }
  return true;
}

function startApp() {
  log(`===========================================`);
  log(`STORK ORACLE 验证机器人已激活`);
  log(`间隔: ${config.intervalSeconds} 秒`);
  log(`令牌路径: ${config.tokenPath}`);
  log(`自动刷新: 已启用`);
  log(`===========================================`);
  let total = 1;

  runValidationProcess(total);

  setInterval(() => {
    total++;
    if (total === 60) {
      total = 1;
    }
    runValidationProcess(total);
  }, config.intervalSeconds * 1000);
}

function main() {
  if (!createTokensFileIfNotExists()) {
    log("应用程序无法启动，因为令牌文件有问题", "ERROR");
    return;
  }

  try {
    const tokensContent = fs.readFileSync(config.tokenPath, "utf8").trim();
    const tokens = JSON.parse(tokensContent);

    if (!tokens.accessToken || tokens.accessToken.length < 20) {
      log("tokens.json 文件存在但包含无效的访问令牌", "ERROR");
      log(
        "请从 Stork Oracle 应用的 localStorage 中填充有效的令牌到 tokens.json 文件",
        "INFO"
      );
      log(
        "必填字段: accessToken, idToken, refreshToken, isAuthenticated, isVerifying",
        "INFO"
      );
      return;
    }

    if (!tokens.refreshToken || tokens.refreshToken.length < 20) {
      log("警告: tokens.json 中未找到刷新令牌。自动刷新将无法工作。", "WARN");
      log("请包含有效的刷新令牌以启用自动刷新功能", "INFO");
    }
  } catch (error) {
    log(`读取令牌文件时出错: ${error.message}`, "ERROR");
    return;
  }

  startApp();
}

main();
