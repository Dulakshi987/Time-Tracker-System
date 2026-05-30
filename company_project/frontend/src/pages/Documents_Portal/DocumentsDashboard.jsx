const [documents, setDocuments] = useState([]);
const [chartData, setChartData] = useState([]);

const loadData = async () => {
  const res = await axios.get("http://localhost:8080/api/documents", {
    params: {
      fromDate: chartFilter.fromDate || null,
      toDate: chartFilter.toDate || null,
      type: selectedType || null
    }
  });

  setDocuments(res.data);
  setChartData(res.data); // SAME DATA FOR CHART
};

useEffect(() => {
  loadData();
}, [chartFilter, selectedType]);