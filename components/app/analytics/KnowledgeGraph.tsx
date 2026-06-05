"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import * as d3 from "d3";
import { masteryToColor, type GraphLink, type GraphNode } from "@/lib/analytics";

interface SimNode extends GraphNode, d3.SimulationNodeDatum {}

interface KnowledgeGraphProps {
  nodes: GraphNode[];
  links: GraphLink[];
}

export default function KnowledgeGraph({ nodes, links }: KnowledgeGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!svgRef.current) return;

    const width = svgRef.current.clientWidth || 400;
    const height = 280;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("viewBox", `0 0 ${width} ${height}`);

    if (nodes.length === 0) return;

    const simNodes: SimNode[] = nodes.map((n) => ({ ...n }));
    const simLinks: d3.SimulationLinkDatum<SimNode>[] = links.map((l) => ({
      source: l.source,
      target: l.target,
    }));

    function linkNode(endpoint: SimNode | string | number): SimNode | undefined {
      if (typeof endpoint === "object") return endpoint;
      return simNodes.find((n) => n.id === endpoint);
    }

    const simulation = d3
      .forceSimulation(simNodes)
      .force(
        "link",
        d3
          .forceLink<SimNode, d3.SimulationLinkDatum<SimNode>>(simLinks)
          .id((d) => d.id)
          .distance(80)
      )
      .force("charge", d3.forceManyBody().strength(-200))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collision", d3.forceCollide().radius(24));

    const link = svg
      .append("g")
      .selectAll("line")
      .data(simLinks)
      .join("line")
      .attr("stroke", "#374151")
      .attr("stroke-width", 1.5)
      .attr("stroke-opacity", 0.6);

    const node = svg
      .append("g")
      .selectAll<SVGGElement, SimNode>("g")
      .data(simNodes)
      .join("g")
      .style("cursor", "pointer")
      .call(
        d3
          .drag<SVGGElement, SimNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      )
      .on("click", (_, d) => router.push(`/aiml/${d.id}`));

    node
      .append("circle")
      .attr("r", 12)
      .attr("fill", (d) => masteryToColor(d.mastery))
      .attr("stroke", "#1f2937")
      .attr("stroke-width", 2);

    node
      .append("text")
      .text((d) => (d.title.length > 14 ? d.title.slice(0, 12) + "…" : d.title))
      .attr("x", 16)
      .attr("y", 4)
      .attr("fill", "#9ca3af")
      .attr("font-size", "10px");

    node.append("title").text((d) => `${d.title} (${Math.round(d.mastery * 100)}% mastery)`);

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => linkNode(d.source)?.x ?? 0)
        .attr("y1", (d) => linkNode(d.source)?.y ?? 0)
        .attr("x2", (d) => linkNode(d.target)?.x ?? 0)
        .attr("y2", (d) => linkNode(d.target)?.y ?? 0);

      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, links, router]);

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        Add AIML concepts to see knowledge graph
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="w-full"
    >
      <svg ref={svgRef} className="w-full h-64" />
      {links.length === 0 && (
        <p className="text-[10px] text-muted-foreground mt-2">
          Add prerequisites to concepts to see dependency edges
        </p>
      )}
    </motion.div>
  );
}
