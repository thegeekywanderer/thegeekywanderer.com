export type Project = {
	title: string;
	techs: string[];
	link: string;
	isComingSoon?: boolean;
};

const projects: Project[] = [
	{
		title: "Athena - Your personal assistant",
		techs: ["FastAPI", "OpenAI", "Azure (Cognitive Search)"],
		link: "https://github.com/thegeekywanderer/athena",
	},
	{
		title: "Fluxy - a gRPC rate limiter",
		techs: ["go", "gRPC", "redis", "kubernetes"],
		link: "https://github.com/thegeekywanderer/fluxy",
	},
	{
		title: "RustCUE",
		techs: ["Rust"],
		link: "/",
		isComingSoon: true,
	},
];

export default projects;
