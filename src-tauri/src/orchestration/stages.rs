use crate::models::{AiProfile, OrchestrationStage};

struct StageTemplate {
    title: &'static str,
    role: &'static str,
    instruction: &'static str,
}

const ROLE_TEMPLATES: &[StageTemplate] = &[
    StageTemplate {
        title: "Node-01 // 探针解析",
        role: "探针解析算子 (Probe)",
        instruction: "你是装具流水线中的 Node-01 探针节点。请对输入的目标指令或技术问题进行首轮结构化拆解与直接回应，优先明确关键结论、核心论据与执行基线。不评述装具内部机制。",
    },
    StageTemplate {
        title: "Node-02 // 深度拓展",
        role: "拓展综合算子 (Synthesis)",
        instruction: "你是装具流水线中的 Node-02 综合节点。请基于目标问题与前序 Node-01 的分析结果进行纵深拓展，补齐架构背景、技术边界、边缘条件与可执行实现细节。避免低效重复。",
    },
    StageTemplate {
        title: "Node-03 // 审校评判",
        role: "评判校验算子 (Critique)",
        instruction: "你是装具流水线中的 Node-03 校验节点。请客观审校前序各节点的输出，指出潜在的逻辑漏洞、安全性隐患与实现风险，收敛分歧并输出高可信度的终极工程建议。",
    },
];

const SPECIALIST_TEMPLATE: StageTemplate = StageTemplate {
    title: "",
    role: "专项处理算子 (Specialist)",
    instruction: "你是装具流水线中的专项扩展节点。请结合前序算子输出，针对专精维度提供增量技术洞察与补充推演。",
};

pub fn build_stages(profiles: &[AiProfile]) -> Vec<OrchestrationStage> {
    profiles
        .iter()
        .enumerate()
        .map(|(index, profile)| {
            let template = ROLE_TEMPLATES
                .get(index)
                .unwrap_or(&SPECIALIST_TEMPLATE);

            let title = if index < ROLE_TEMPLATES.len() {
                template.title.to_string()
            } else {
                format!("Node-{:02} // 专项算子", index + 1)
            };

            let depends_on = if index == 0 {
                vec![]
            } else {
                vec![format!("{}-{}", profiles[index - 1].id, index - 1)]
            };

            OrchestrationStage {
                id: format!("{}-{}", profile.id, index),
                title,
                role: template.role.to_string(),
                instruction: template.instruction.to_string(),
                profile: profile.clone(),
                depends_on,
            }
        })
        .collect()
}

pub fn stage_message_id(stage: &OrchestrationStage) -> String {
    stage.id.clone()
}

pub fn kernel_stage_prompt(stage: &OrchestrationStage, index: usize, user_input: &str, soul: Option<&str>) -> String {
    let persona = stage.profile.system_prompt.trim();
    let mut prompt = String::new();
    if index == 0 {
        if let Some(soul) = soul.map(str::trim).filter(|s| !s.is_empty()) {
            prompt.push_str(&format!("[人格设定]\n{soul}\n\n"));
        }
        if !persona.is_empty() {
            prompt.push_str(&format!("[算子准则]\n{persona}\n\n"));
        }
        prompt.push_str(&format!(
            "[节点指令] {}\n\n[操作员输入]\n{}",
            stage.instruction, user_input
        ));
    } else {
        prompt.push_str(&format!(
            "[节点指令] {}\n\n（前序节点输出已在本会话上下文中，请基于其继续推进。）",
            stage.instruction
        ));
    }
    prompt
}
