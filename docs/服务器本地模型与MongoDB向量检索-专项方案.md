# 服务器本地模型与 MongoDB 向量检索专项方案

日期：2026-10-18  
状态：方案，未执行部署或数据迁移。  
前提：按用户最新要求，目标架构使用 MongoDB 作为唯一业务数据库，模型部署在服务器。本文只定义模型、向量、索引及相关更新机制，不展开 MySQL 数据迁移或其他业务改造。上一份方案中“保留 MySQL 主库”的建议不作为本文前提。

## 1. 本次建议

采用 **服务器本地 embedding + 服务器本地理解模型 + MongoDB 原始资料集合 + 独立向量集合 + MongoDB Search / Vector Search**。

模型服务与数据库是不同进程：模型文件存服务器磁盘，MongoDB存业务资料、模型版本元数据和向量；MongoDB不负责执行神经网络推理，也不需要把模型权重存入数据库。

初始选型：

| 职责         | 首选基线                                | 部署                          | 作用                                        |
| ------------ | --------------------------------------- | ----------------------------- | ------------------------------------------- |
| 向量生成     | BAAI/bge-small-zh-v1.5，512维           | CPU，ONNX，先比较FP32与INT8   | 中文材料名、短订单及已确认习惯的相似检索    |
| 复杂语义备选 | Qwen3-Embedding-0.6B，独立1024维profile | CPU可行性单独压测             | 中英混合、复杂材料表达；不能直接混入BGE索引 |
| 原文理解     | Qwen3-4B-GGUF，Q4_K_M                   | llama.cpp CPU服务             | 按模块解析原文、结合候选输出结构化草稿      |
| 重排         | 第一阶段不用额外模型                    | 规则 + 名称 + 规格 + 历史排序 | 后续确有必要才加入小型reranker              |

模型卡：[BGE](https://huggingface.co/BAAI/bge-small-zh-v1.5)、[Qwen embedding](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)、[Qwen理解模型](https://huggingface.co/Qwen/Qwen3-4B-GGUF)。这些是可复现基线，不宣称是所有任务的最强模型。4B CPU理解模型必须单独验证订单合并、日期、数量和BOM漏行情况，不能因支持JSON就认定质量等于现有线上模型。

## 2. 服务器上运行什么

```text
现有 API
  ├─ 本地理解服务：127.0.0.1:8092
  ├─ 本地 embedding 服务：127.0.0.1:8091
  └─ MongoDB mongod
       ├─ 原始资料、习惯、模型profile、待处理标记
       ├─ 向量集合及缓存
       └─ 转发搜索请求到配套 mongot 搜索进程

独立 embedding Worker
  └─ 读Mongo源记录 → 本地向量化 → 写Mongo向量集合
```

上图是逻辑关系，不表示一个mongot进程、一个standalone Mongo实例就构成正式部署拓扑。实际数量、replica set和资源按官方支持组合配置。模型服务不直接读写业务记录，API负责取数据并校验结果；App只调用API。

截至2026-10-18查阅，MongoDB自托管搜索当前兼容矩阵涉及Server 8.3与mongot 1.70.1及以后；特定部署方式还有其补丁版本要求。普通MongoDB安装不自动具备向量搜索，需要选定正式支持的mongod/mongot组合；atlas-local用于开发，不作为生产目标。当前项目运维文档记录Alibaba Cloud Linux 4，须核对平台支持，不能直接套用其他Linux发行版命令。[官方兼容要求](https://www.mongodb.com/docs/search/self-managed/current/deployment/compatibility-requirements/)

## 3. 本地模型的配置与生命周期

### 3.1 Embedding

- TypeScript服务使用经过验证的Transformers.js/ONNX CPU运行时；模型转换制品的来源和哈希单独记录。
- BGE采用对应模型的CLS池化、归一化和query指令；材料文档模板与查询模板固定。
- BGE512 token限制包含特殊token和指令；短材料文档优先控制在256 token内。订单按客户/交付/商品语义块组织，不把整个月资料或整库拼成一个向量。
- CPU从2线程、单路请求、batch4起步；模型启动加载并预热，常驻内存，不按每次请求重新加载。
- 固定profile：`bge_zh_v15_fp32_cls512_tpl1`；量化版另用`bge_zh_v15_q8_cls512_tpl1`。即使维度相同，也先独立评测再决定是否可替换。
- 服务输入为有条数/长度限制的`texts + purpose(query/document)`，输出为`vectors + profile_id`。
- API检查数组长度、维度、有限数值、非零向量；禁止错误向量写入索引。

### 3.2 理解模型

- Qwen3-4B Q4_K_M由固定版本llama-server提供兼容接口。
- CPU模式明确不使用GPU；并发从1路起，上下文从4096 token做试验，输入不足以容纳时提示分批，不能静默截断。
- 使用非思考模式和受支持的JSON约束；仍由API做Zod校验、日期规则、候选ID验证。
- 模型只生成草稿或候选解释，不执行写数据库、删除或自动确认。
- 原始输入中缺少的数量、日期、价格不能从历史相似单据直接复制。
- 本地服务失败则保留人工填写；全本地模式默认禁止静默调用外部API。

### 3.3 模型文件与缓存

```text
/var/lib/tmy-models/
  bge-small-zh-v1.5/<固定revision>/
  qwen3-4b/<固定revision>/
```

部署阶段下载一次并核对SHA256，运行阶段只从本地加载，关闭远程自动下载。文件缺失或版本不符就报服务不可用，不在每次解析时重新下载。模型权重不随员工App发布。

Mongo中的`model_profiles`仅记录模型名、文件指纹、维度、pooling、归一化、模板版本、运行时版本与启用状态，不存权重。理解模型、embedding和未来reranker分别配置，不共享一个含糊的model_name。

## 4. MongoDB 中怎样存向量

### 4.1 不是所有字段都做 embedding

业务资料全部放MongoDB的目标，不代表全部字段都要向量化。语义文本包含商品名、已确认别名、规格描述、业务类型和脱敏习惯；编码、日期、公司、启用状态等仍作结构化字段。金额、数量计算不靠向量相似度。

向量集合与原始资料分开，便于重建、换模型和限制查询字段。建议按业务域和profile隔离：

| 集合                         | 用途                                     |
| ---------------------------- | ---------------------------------------- |
| `bom_vectors_bge512_v1`      | 金蝶材料/成品名称与已确认别名            |
| `retail_vectors_bge512_v1`   | 已确认的零售表达和习惯样例               |
| `delivery_vectors_bge512_v1` | 送货商品自由输入历史、客户情景和署名习惯 |
| `schedule_vectors_bge512_v1` | 排班表达模板；不默认复制员工私人历史     |
| `embedding_cache_bge512_v1`  | 相同文本与相同用途的向量缓存             |

即使共用MongoDB，也不把BOM金蝶商品候选混入送货单商品库。员工、部门仍是全局资料，没有公司属性；BOM按公司账套检索，其他域根据具体业务范围过滤。

### 4.2 向量文档字段

```typescript
import type { Long } from "mongodb";

interface VectorDocument {
  _id: string; // domain:source_id:chunk_key
  source_collection: string;
  source_id: string;
  semantic_revision: Long; // BSON Int64，避免Number精度问题
  chunk_key: string; // 稳定业务子块标识
  workspace_id: string;
  domain: "bom" | "retail" | "delivery" | "schedule";
  company_code?: "tri" | "tmy";
  is_active: boolean;
  is_deleted: boolean;
  normalized_name: string;
  search_text: string;
  spec_attributes: Record<string, string>;
  unit?: string;
  embedding_profile: string;
  embedding: number[]; // 实际必须满足当前profile维度
  content_hash: string;
  indexed_at: Date;
}
```

其中公司字段只用于该资料本身有归属的场景，不为员工强加公司。向量只帮助定位资料；最终返回前读取Mongo原始记录，验证未删除、启用、权限、版本及目标业务日期。

## 5. 要建哪些索引

### 5.1 普通MongoDB索引

- `_id`：稳定、唯一；业务域/源ID/chunk_key组成键。
- `source_collection + source_id`：定位一个源记录的所有向量块，方便更新/清除旧块。
- `workspace_id + normalized_name`：精确名称与已确认别名查询，必要时再加company_code。
- 原始集合上的待向量化标记及更新时间：供补偿扫描，不每次扫全库。
- 缓存唯一键：`profile + purpose + text_hash`；缓存可使用TTL，权威资料与删除墓碑不使用短期TTL。

### 5.2 全文搜索索引

对材料名、别名、规格描述建立MongoDB Search索引，用于名称检索和词法召回；中文分词器按锁定版本验证。它与普通MongoDB的`text`索引不是同一种能力。

### 5.3 向量索引

BGE示例采用512维、cosine相似度，并为过滤字段建filter索引：

```json
{
  "name": "bom_bge512_v1",
  "type": "vectorSearch",
  "definition": {
    "fields": [
      {
        "type": "vector",
        "path": "embedding",
        "numDimensions": 512,
        "similarity": "cosine"
      },
      { "type": "filter", "path": "workspace_id" },
      { "type": "filter", "path": "company_code" },
      { "type": "filter", "path": "embedding_profile" },
      { "type": "filter", "path": "is_active" },
      { "type": "filter", "path": "is_deleted" }
    ]
  }
}
```

使用支持的Search Index管理接口创建并等待就绪，不用普通`createIndex`代替向量索引。查询使用`$vectorSearch` stage；Top20、numCandidates400作为初始实验参数，按Recall与延迟调节，不代表适合所有规模。[索引文档](https://www.mongodb.com/docs/vector-search/indexes/vector-search-type/?deployment-type=atlas&embedding=byo&interface=atlas-cli&language=None)、[查询文档](https://www.mongodb.com/docs/atlas/atlas-vector-search/vector-search-stage/?deployment-type=self&embedding=auto&interface=driver&language=java-sync)

普通索引用于准确取数，全文字段用于名称匹配，向量索引用于语义相似；三者同时存在，不把数据库所有查询改成向量查询。

## 6. 查询怎么跑

```text
用户输入
  → 识别模块，提取原始名称/规格/单位/明确日期
  → 先查精确编码、有效别名、已确认规则
  → 本地embedding生成查询向量（缓存优先）
  → 按域、公司/工作台、启用与权限条件预过滤
  → 向量Top20 + 全文/名称Top20
  → 去重、规格与单位验证、历史习惯重排
  → 取Top5并回读Mongo原始资料验证
  → 理解模型按结构化候选辅助生成草稿
  → 用户在原表单确认
```

BOM先理解整张配方，再对不同材料批量检索，避免每行单独请求理解模型。首次解析前的历史样例检索可辅助格式理解，但不把所有材料命中结果强行塞入一条超长提示词。

规则优先级：明确编码/有效人工规则 → 精确名称与规格 → 已确认历史 → 相似语义。语义分数不是正确概率，不允许因为“植物奶油和动物奶油相似”就自动替换。只命中语义的材料先作为建议；确认缺失项时仍一次性批量处理。

## 7. 向量怎样随资料变化

由于源资料与向量都在MongoDB，不再设计MySQL→Mongo同步；但**原文变更到向量刷新仍是异步过程**，不能假定模型在数据库事务中自动完成推理。

推荐采用原始资料的持久待处理标记 + Worker，Change Streams作为实时唤醒机制：

1. 与语义相关的资料发生变化时，原文同一文档原子递增`semantic_revision`，设置`embedding_pending=true`；金额等非语义字段变化不必重算向量。
2. Worker读取源资料当前版本，在事务/锁之外调用本地embedding。
3. 返回后再次检查源修订号；如果已经变更，丢弃旧结果并重新处理。
4. 向量文档仅接受更新修订号；同修订号的hash不一致视为错误。唯一键冲突不通过无条件覆盖解决。
5. 多块源资料按修订号生成本轮块；原记录清除pending前再次CAS检查版本。检索候选必须对应当前源版本，旧块不再使用；遗漏旧chunk异步清理。必要时先验证一轮块完整，再切换源的active向量修订号，换代期间回退名称检索。
6. 停用/软删先使原始资料失效并设置待处理，Worker给向量写高版本删除墓碑；最后查询回读源记录，防止搜索索引延迟继续返回旧候选。
7. 每隔一段时间扫描pending和修订号差异，补偿Worker中断与漏事件；不只依赖一次通知。

Change Streams必须有支持的replica set/分片部署；持久保存resume token，在任务已可靠记录后才推进。若断档超过保留窗口，执行补偿扫描/重建，而不是从“现在”继续并忽略中间变更。Worker只监听指定原始集合，不监听自己写的向量集合，防止循环触发。[MongoDB Change Streams](https://www.mongodb.com/docs/manual/changestreams/)

如果未来业务写入路径无法保证待处理标记，改用Mongo事务内的持久索引任务集合；不能仅靠应用内事件或内存队列。

## 8. 换模型与容灾

- 新模型生成新profile、新集合、新向量索引；不能在同一索引混用BGE512与Qwen1024。
- 即使维度相同，不同模型/pooling/量化/模板也先独立空间评测，不能默认互通。
- 后台回填新集合，按材料测试集验证Recall@5/Top1及误匹配率；通过后原子切换活动profile，保留旧profile便于回退。
- 索引重建期间原始资料继续可查；向量失败回退Mongo精确/名称检索，不影响手工输入。
- 模型缓存按内容hash命中；全量资料首次向量化一次，新增/改动才算；换模型必须重算对应语料。
- CPU资源不足时先暂停离线回填，限制实时embedding与理解模型并发，不允许后台任务把数据库CPU占满。

## 9. 资源和验收范围

本次没有查看当前ECS规格与GPU，不能认定原实例能承载本方案。资源预留应包括mongod、配套mongot、API、embedding、理解模型及索引重建的峰值。

CPU试验可分别预留：BGE2–4GB RAM；Qwen embedding4–8GB；4B量化理解服务16GB RAM级别独立预留。它们是工程试验额度，不是实测最低用量。若所有服务同一台机器同时运行，可从16 vCPU / 64GB RAM级别做容量评估；不需要GPU，但CPU理解并发和完成时间必须实测。多机高可用及生产部署不在本文展开。

验收至少包括：

- 材料同义词召回、规格冲突、跨公司错误候选；送货与BOM数据域不互通。
- 同文本缓存命中、模型进程重启后只读本地文件、不同profile不混查。
- 原资料更新/停用/删除后，旧向量不再用于结果；慢任务不能复活旧内容。
- BGE与Qwen向量模型在同一固定样例集的Recall@5/Top1、CPU、内存和P95；不凭模型大小猜效果。
- 本地理解模型的订单合并、日期、数量、schema及完整JSON延迟；并发1/2/4分别压测。
- 向量/理解服务不可用时，仍可以Mongo名称检索或手工填写；不自动调用外部API。

## 10. 本次确定的技术方向

1. 模型在服务器独立运行，模型文件本地缓存一次，App不下载权重。
2. MongoDB是目标唯一数据源；原始资料和向量分集合，使用普通索引、全文索引和向量索引各司其职。
3. 初始CPU路线为BGE中文512维 + 本地Qwen3-4B量化理解；Qwen embedding作为单独对比方案。
4. 向量按变更异步更新，持久状态兜底，原记录版本与资格始终优先。
5. 本文不实施数据迁移、采购或部署；业务改造范围留待下一份方案。
